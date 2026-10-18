import type { ActionCapability, BoundaryRule, ControlsView, GrantPreset } from '../shared/controls';
import { normalizeDomain, matchesDomain } from '../shared/domains';

const CAPABILITIES: ActionCapability[] = ['click', 'type', 'submit', 'navigate', 'open_window', 'network', 'download', 'modify_dom'];
const empty = (): ControlsView => ({ schemaVersion: 1, grants: [], pauses: [], log: [] });
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/u.test(value);
const domain = (value: unknown): value is string => typeof value === 'string' && normalizeDomain(value) === value;
export function domains(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 100 || input.some(item => typeof item !== 'string')) throw new Error('Invalid domains');
  return [...new Set(input.map(item => normalizeDomain(item as string)))];
}
export function grantPreset(value: unknown): value is GrantPreset { return value === 'READ_ONLY' || value === 'LIMITED' || value === 'FULL_ACCESS'; }

/** Session-only controls cannot rebind a grant to a reused tab ID after browser restart. */
export class ControlStore {
  private data = empty();
  private queue: Promise<void> = Promise.resolve();
  private revision = Date.now();
  constructor(private readonly port: { read(): Promise<unknown>; write(value: ControlsView): Promise<void> }, private readonly now = Date.now, private readonly maximumMinutes = () => 60) {}
  async load(liveTabs: ReadonlySet<number>): Promise<void> {
    const input = await this.port.read() as ControlsView | undefined;
    if (input === undefined) return;
    try {
      if (!input || input.schemaVersion !== 1 || !Array.isArray(input.grants) || input.grants.length > 500 ||
        !Array.isArray(input.pauses) || input.pauses.length > 100) throw new Error('Invalid controls');
      const grants = input.grants.filter(grant => uuid(grant.id) && integer(grant.tabId) && grant.tabId <= 2_147_483_647 && liveTabs.has(grant.tabId) && grantPreset(grant.preset) &&
        integer(grant.createdAt) && integer(grant.expiresAt) && grant.createdAt <= this.now() && grant.expiresAt > this.now() && grant.expiresAt - grant.createdAt <= 60 * 60_000 &&
        domains(grant.allowedDomains).every((item, index) => item === grant.allowedDomains[index]) && domains(grant.blockedDomains).every((item, index) => item === grant.blockedDomains[index]))
        .map(grant => ({ id: grant.id, tabId: grant.tabId, preset: grant.preset, allowedDomains: domains(grant.allowedDomains), blockedDomains: domains(grant.blockedDomains), createdAt: grant.createdAt, expiresAt: grant.expiresAt }));
      const pauses = input.pauses.filter(pause => uuid(pause.id) && (pause.domain === null || domain(pause.domain)) && integer(pause.createdAt) && integer(pause.expiresAt) &&
        pause.createdAt <= this.now() && pause.expiresAt > this.now() && pause.expiresAt - pause.createdAt <= 86_400_000)
        .map(pause => ({ id: pause.id, domain: pause.domain, createdAt: pause.createdAt, expiresAt: pause.expiresAt }));
      this.data = { schemaVersion: 1, grants, pauses, log: [] };
    } catch { throw new Error('Stored delegation controls are invalid'); }
  }
  private change(work: (next: ControlsView) => void): Promise<ControlsView> {
    const pending = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const now = this.now();
      next.grants = next.grants.filter(grant => grant.expiresAt > now);
      next.pauses = next.pauses.filter(pause => pause.expiresAt > now);
      work(next); next.log = next.log.slice(-100);
      await this.port.write(next); this.data = next; this.revision = Math.max(this.revision + 1, now);
      return this.snapshot();
    });
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
  grant(tabId: number, preset: GrantPreset, allowed: string[], blocked: string[], minutes: number, maximumMinutes: number): Promise<ControlsView> {
    if (!integer(tabId) || tabId > 2_147_483_647 || !grantPreset(preset) || !Number.isInteger(minutes) || minutes < 1 || minutes > Math.min(60, maximumMinutes)) return Promise.reject(new Error('Invalid delegation'));
    const allowedDomains = domains(allowed), blockedDomains = domains(blocked);
    if (preset === 'LIMITED' && allowedDomains.length === 0) return Promise.reject(new Error('Limited grants need an allowlist'));
    return this.change(next => {
      next.grants = next.grants.filter(grant => grant.tabId !== tabId);
      if (next.grants.length >= 500) throw new Error('Delegation capacity reached');
      next.grants.push({ id: crypto.randomUUID(), tabId, preset, allowedDomains, blockedDomains, createdAt: this.now(), expiresAt: this.now() + minutes * 60_000 });
      next.log.push({ timestamp: this.now(), type: 'granted', tabId, domain: null });
    });
  }
  revoke(tabId: number): Promise<ControlsView> { return this.change(next => {
    next.grants = next.grants.filter(grant => grant.tabId !== tabId);
    next.log.push({ timestamp: this.now(), type: 'revoked', tabId, domain: null });
  }); }
  pause(hostname: string | null, minutes: number): Promise<ControlsView> {
    if ((hostname !== null && !domain(hostname)) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return Promise.reject(new Error('Invalid pause'));
    return this.change(next => {
      next.pauses = next.pauses.filter(pause => pause.domain !== hostname);
      if (next.pauses.length >= 100) throw new Error('Pause capacity reached');
      next.pauses.push({ id: crypto.randomUUID(), domain: hostname, createdAt: this.now(), expiresAt: this.now() + minutes * 60_000 });
      next.log.push({ timestamp: this.now(), type: 'paused', tabId: null, domain: hostname });
    });
  }
  resume(id: string): Promise<ControlsView> { return this.change(next => {
    const pause = next.pauses.find(item => item.id === id);
    next.pauses = next.pauses.filter(item => item.id !== id);
    if (pause) next.log.push({ timestamp: this.now(), type: 'resumed', tabId: null, domain: pause.domain });
  }); }
  revokeAll(): Promise<ControlsView> { return this.change(next => {
    next.grants = []; next.pauses = []; next.log.push({ timestamp: this.now(), type: 'emergency_reset', tabId: null, domain: null });
  }); }
  async reconcileLimits(): Promise<void> {
    if (!this.data.grants.some(grant => grant.expiresAt > grant.createdAt + this.maximumMinutes() * 60_000)) return;
    await this.change(next => {
      next.grants = next.grants.map(grant => ({ ...grant, expiresAt: Math.min(grant.expiresAt, grant.createdAt + this.maximumMinutes() * 60_000) })).filter(grant => grant.expiresAt > this.now());
    });
  }
  snapshot(): ControlsView {
    const now = this.now();
    // New administrator caps also shorten existing grants, not only future ones.
    const grants = this.data.grants.map(grant => ({ ...grant, expiresAt: Math.min(grant.expiresAt, grant.createdAt + this.maximumMinutes() * 60_000) })).filter(grant => grant.expiresAt > now);
    return structuredClone({ ...this.data, grants, pauses: this.data.pauses.filter(pause => pause.expiresAt > now) });
  }
  rule(tabId: number, hostname: string, enabled: boolean): BoundaryRule {
    const current = this.snapshot();
    const grant = enabled ? current.grants.find(item => item.tabId === tabId) : undefined;
    const paused = current.pauses.some(item => item.domain === null || item.domain === hostname);
    const noRule = { revision: this.revision, expiresAt: this.now() + 90_000, blocked: [], blockedDomains: [], allowedDomains: [] };
    if (!grant || paused) return noRule;
    const outsideScope = (grant.allowedDomains.length > 0 && !grant.allowedDomains.some(item => matchesDomain(hostname, item))) || grant.blockedDomains.some(item => matchesDomain(hostname, item));
    const blocked = outsideScope ? CAPABILITIES : grant.preset === 'READ_ONLY' ? CAPABILITIES.filter(item => item !== 'navigate') : grant.preset === 'LIMITED' ? ['submit', 'open_window', 'network', 'download', 'modify_dom'] as ActionCapability[] : [];
    return { revision: this.revision, expiresAt: Math.min(grant.expiresAt, this.now() + 90_000), blocked, blockedDomains: grant.blockedDomains, allowedDomains: grant.allowedDomains };
  }
}
