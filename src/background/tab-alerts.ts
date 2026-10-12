import type { TabAgentStatus } from '../shared/contracts';
import { hasAutomation } from '../shared/intelligence';
import type { TabAlertPresentation, TabAlertStack } from '../content/tab-alert';

export const ALERT_MUTE_MS = 86_400_000;
export const MAX_ALERT_TABS = 1000;
export const MAX_STACK_TABS = 500;
export interface AlertMuteData { schemaVersion: 1; entries: { tabId: number; mutedUntil: number }[] }
export interface TabAlertPort {
  read(): Promise<unknown>;
  write(data: AlertMuteData): Promise<void>;
  assessments(): readonly TabAgentStatus[];
  recipients(): Promise<number[]>;
  document(tabId: number): Promise<string | null>;
  present(tabId: number, documentId: string, input: TabAlertStack | null): Promise<void>;
  activate(tabId: number): Promise<void>;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const tabIdValid = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) >= 0 && (id as number) <= 2_147_483_647;
export function parseAlertActivation(value: unknown): string | null {
  return record(value) && exact(value, ['type', 'schemaVersion', 'token']) && value.type === 'ACTIVATE_TAB_ALERT' && value.schemaVersion === 1 &&
    typeof value.token === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value.token) ? value.token : null;
}
export function parseAlertMutes(value: unknown, liveTabs: ReadonlySet<number>, now: number): Map<number, number> {
  const result = new Map<number, number>();
  if (!record(value) || !exact(value, ['schemaVersion', 'entries']) || value.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_ALERT_TABS) return result;
  const seen = new Set<number>();
  for (const entry of value.entries) {
    if (!record(entry) || !exact(entry, ['tabId', 'mutedUntil']) || !tabIdValid(entry.tabId) || seen.has(entry.tabId) ||
        !Number.isSafeInteger(entry.mutedUntil) || (entry.mutedUntil as number) < 0 || (entry.mutedUntil as number) > now + ALERT_MUTE_MS) return new Map();
    seen.add(entry.tabId);
    if (liveTabs.has(entry.tabId) && (entry.mutedUntil as number) > now) result.set(entry.tabId, entry.mutedUntil as number);
  }
  return result;
}

/** Presentation-only state, separate from detection and policy. No URLs or page text retained. */
export class TabAlerts {
  private mutes = new Map<number, number>();
  private issued = new Map<number, { documentId: string; entries: Map<string, { source: TabAgentStatus; documentId: string }> }>();
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly port: TabAlertPort, private readonly now = Date.now, private readonly token: () => string = () => crypto.randomUUID()) {}
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private async save(next: Map<number, number>): Promise<void> {
    await this.port.write({ schemaVersion: 1, entries: [...next].map(([tabId, mutedUntil]) => ({ tabId, mutedUntil })) });
    this.mutes = next;
  }
  load(liveTabs: ReadonlySet<number>): Promise<void> {
    return this.serialize(async () => { this.mutes = parseAlertMutes(await this.port.read(), liveTabs, this.now()); });
  }
  private available(source: TabAgentStatus): boolean {
    return hasAutomation(source.status) && source.expiresAt > this.now() && (this.mutes.get(source.tabId) ?? 0) <= this.now() &&
      this.port.assessments().some(tab => tab === source);
  }
  refresh(): Promise<void> { return this.serialize(() => this.presentStacks()); }
  private async presentStacks(): Promise<void> {
    const recipients = new Set((await this.port.recipients()).filter(tabIdValid).slice(0, MAX_STACK_TABS));
    this.revision = Math.max(this.revision + 1, this.now() * 1000);
    let failed = false;
    for (const [hostId, prior] of this.issued) {
      if (recipients.has(hostId)) continue;
      this.issued.delete(hostId);
      try { await this.port.present(hostId, prior.documentId, { revision: this.revision, alerts: [] }); } catch { /* Closed/navigated hosts need no teardown. */ }
    }
    const candidates = this.port.assessments().filter(tab => this.available(tab)).slice(0, MAX_STACK_TABS).sort((a, b) => a.tabId - b.tabId);
    const sources: { source: TabAgentStatus; documentId: string }[] = [];
    // One lookup per source, shared across active windows; never broadcast to every background tab.
    for (let start = 0; start < candidates.length; start += 4) {
      const batch = await Promise.all(candidates.slice(start, start + 4).map(async source => {
        try {
          const documentId = await this.port.document(source.tabId);
          return documentId && this.available(source) ? { source, documentId } : null;
        } catch { return null; }
      }));
      sources.push(...batch.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
    }
    for (const hostId of recipients) {
      try {
        const documentId = await this.port.document(hostId);
        if (!documentId) { this.issued.delete(hostId); continue; }
        const prior = this.issued.get(hostId);
        const entries = new Map<string, { source: TabAgentStatus; documentId: string }>();
        const alerts: TabAlertPresentation[] = [];
        for (const entry of sources) {
          if (!this.available(entry.source)) continue;
          const { source } = entry;
          const existing = prior?.documentId === documentId ? [...prior.entries].find(([, value]) =>
            value.source.tabId === source.tabId && value.documentId === entry.documentId) : undefined;
          const token = existing?.[0] ?? this.token();
          entries.set(token, entry);
          alerts.push({ tabId: source.tabId, domain: source.domain, state: source.status as TabAlertPresentation['state'],
            confidence: source.confidence, assessedAt: source.assessedAt, expiresAt: source.expiresAt, token });
        }
        this.issued.set(hostId, { documentId, entries });
        await this.port.present(hostId, documentId, { revision: this.revision, alerts });
      } catch { this.issued.delete(hostId); failed = true; }
    }
    if (failed) throw new Error('Some notification hosts are unavailable');
  }
  activate(hostId: number, documentId: string, token: string): Promise<number | null> {
    return this.serialize(async () => {
      const issued = this.issued.get(hostId);
      const entry = issued?.entries.get(token);
      if (!issued || !entry || issued.documentId !== documentId || !this.available(entry.source) ||
          await this.port.document(hostId) !== documentId || await this.port.document(entry.source.tabId) !== entry.documentId) return null;
      if (this.issued.get(hostId) !== issued || issued.entries.get(token) !== entry || !this.available(entry.source)) return null;
      await this.port.activate(entry.source.tabId); // Existing tab only; never navigate to a page-supplied URL.
      if (issued.entries.get(token) !== entry || !this.available(entry.source)) return null;
      const now = this.now();
      const next = new Map([...this.mutes].filter(([, until]) => until > now));
      if (!next.has(entry.source.tabId) && next.size >= MAX_ALERT_TABS) throw new Error('Alert mute capacity reached');
      const mutedUntil = now + ALERT_MUTE_MS;
      next.set(entry.source.tabId, mutedUntil);
      await this.save(next); // Never acknowledge a dismissal that was not saved.
      this.revokeSource(entry.source.tabId);
      return mutedUntil;
    });
  }
  private revokeSource(tabId: number): void {
    for (const host of this.issued.values()) for (const [token, entry] of host.entries) {
      if (entry.source.tabId === tabId) host.entries.delete(token);
    }
  }
  invalidate(tabId: number): void {
    this.revokeSource(tabId);
    // Keep the old host for teardown, but revoke its capabilities synchronously.
    this.issued.get(tabId)?.entries.clear();
  }
  forget(tabId: number): Promise<void> {
    this.invalidate(tabId);
    this.issued.delete(tabId);
    return this.serialize(async () => {
      if (!this.mutes.has(tabId)) return;
      const next = new Map(this.mutes);
      next.delete(tabId);
      await this.save(next);
    });
  }
}
