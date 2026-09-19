import type { AgentGuardConfig, AuditEnvelope, AuditEvent, AuditEventType, PolicyAction } from '../shared/contracts';
import { normalizeDomain } from '../shared/domains';

const STORAGE_KEY = 'agentguard.audit.v1';
const DAY_MS = 86_400_000;
const EVENT_TYPES: readonly AuditEventType[] = [
  'detection_changed', 'policy_triggered', 'quarantined', 'released',
  'tab_closed', 'settings_changed', 'enforcement_failed', 'coverage_changed',
];
const POLICY_ACTIONS: readonly PolicyAction[] = ['none', 'monitor', 'warn', 'quarantine'];

/** Detail is deliberately static so error strings, URLs, and page data never enter the log. */
const SAFE_DETAILS: Record<AuditEventType, string> = {
  detection_changed: 'Tab automation assessment changed',
  policy_triggered: 'Sensitive-domain policy triggered',
  quarantined: 'Tab quarantine requested',
  released: 'Tab quarantine released',
  tab_closed: 'Tab closed',
  settings_changed: 'Settings changed',
  enforcement_failed: 'Policy enforcement failed',
  coverage_changed: 'Detection coverage changed',
};

export interface AuditStoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export type AuditLimits = Pick<AgentGuardConfig, 'retentionDays' | 'maxAuditEvents'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeEvent(input: unknown): AuditEvent | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(input.id)) return null;
  if (typeof input.timestamp !== 'number' || !Number.isSafeInteger(input.timestamp) || input.timestamp < 0) return null;
  if (input.tabId !== null && (!Number.isSafeInteger(input.tabId) || (input.tabId as number) < 0)) return null;
  if (typeof input.eventType !== 'string' || !EVENT_TYPES.includes(input.eventType as AuditEventType)) return null;
  if (typeof input.policyAction !== 'string' || !POLICY_ACTIONS.includes(input.policyAction as PolicyAction)) return null;
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) ||
      input.confidence < 0 || input.confidence > 1) return null;
  let domain: string | null = null;
  if (input.domain !== null) {
    if (typeof input.domain !== 'string' || input.domain.startsWith('*.')) return null;
    try {
      domain = normalizeDomain(input.domain);
    } catch {
      return null;
    }
  }
  const eventType = input.eventType as AuditEventType;
  return {
    id: input.id,
    timestamp: input.timestamp,
    tabId: input.tabId as number | null,
    domain,
    eventType,
    detectedAgent: null,
    confidence: input.confidence,
    policyAction: input.policyAction as PolicyAction,
    detail: SAFE_DETAILS[eventType],
  };
}

/** A local, serialized, bounded event ring. It never accesses Chrome at import time. */
export class AuditStore {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: AuditStoragePort,
    private readonly limits: () => AuditLimits,
    private readonly now: () => number = Date.now,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readBounded(persistPruned = false): Promise<AuditEvent[]> {
    const { retentionDays, maxAuditEvents } = this.limits();
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90 ||
        !Number.isInteger(maxAuditEvents) || maxAuditEvents < 100 || maxAuditEvents > 5000) {
      throw new Error('Invalid audit retention limits');
    }
    const raw = await this.storage.get(STORAGE_KEY);
    if (!Array.isArray(raw)) {
      if (persistPruned && raw !== undefined) await this.storage.set(STORAGE_KEY, []);
      return [];
    }
    const currentTime = this.now();
    const cutoff = currentTime - retentionDays * DAY_MS;
    const events = raw
      .map(sanitizeEvent)
      .filter((event): event is AuditEvent => event !== null && event.timestamp >= cutoff &&
        event.timestamp <= currentTime + 60_000)
      .slice(-maxAuditEvents);
    if (persistPruned && JSON.stringify(raw) !== JSON.stringify(events)) await this.storage.set(STORAGE_KEY, events);
    return events;
  }

  append(event: AuditEvent): Promise<void> {
    return this.serialize(async () => {
      const clean = sanitizeEvent(event);
      if (!clean) throw new Error('Invalid audit event');
      const current = await this.readBounded();
      const { retentionDays, maxAuditEvents } = this.limits();
      const currentTime = this.now();
      if (clean.timestamp >= currentTime - retentionDays * DAY_MS && clean.timestamp <= currentTime + 60_000) {
        current.push(clean);
      }
      await this.storage.set(STORAGE_KEY, current.slice(-maxAuditEvents));
    });
  }

  list(): Promise<AuditEvent[]> {
    return this.serialize(() => this.readBounded(true));
  }

  clear(): Promise<void> {
    return this.serialize(() => this.storage.set(STORAGE_KEY, []));
  }

  export(): Promise<AuditEnvelope> {
    return this.serialize(async () => ({
      schemaVersion: 1,
      exportedAt: this.now(),
      source: 'agentguard-extension',
      events: await this.readBounded(true),
    }));
  }
}
