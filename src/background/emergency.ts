import type { TabAgentStatus } from '../shared/contracts';
import type { EmergencyState } from '../shared/emergency';
import { hasAutomation } from '../shared/intelligence';
import { normalizeDomain } from '../shared/domains';

const initial = (): EmergencyState => ({ schemaVersion: 1, active: false, activatedAt: null, outcomes: [] });
export interface EmergencyPort {
  read(): Promise<unknown>;
  write(state: EmergencyState): Promise<void>;
  assessments(): readonly TabAgentStatus[];
  act(tab: Readonly<TabAgentStatus>, action: 'quarantine' | 'close'): Promise<void>;
  revokeGrants(): Promise<void>;
}
/** Persists intent before acting; never reports a successful stop without an actual outcome. */
export class EmergencyController {
  private state = initial();
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly port: EmergencyPort, private readonly now = Date.now) {}
  async load(): Promise<void> {
    const raw = await this.port.read() as Partial<EmergencyState> | undefined;
    if (raw === undefined) return;
    if (!raw || raw.schemaVersion !== 1 || typeof raw.active !== 'boolean' ||
      (raw.activatedAt !== null && (!Number.isSafeInteger(raw.activatedAt) || raw.activatedAt! < 0))) throw new Error('Emergency state unavailable');
    if (raw.active && raw.activatedAt === null) throw new Error('Emergency activation time unavailable');
    if (!Array.isArray(raw.outcomes) || raw.outcomes.length > 500) throw new Error('Invalid emergency outcomes');
    const outcomes = raw.outcomes.map(outcome => {
      if (!Number.isSafeInteger(outcome.tabId) || outcome.tabId < 0 || outcome.tabId > 2_147_483_647 ||
        (outcome.domain !== null && normalizeDomain(outcome.domain) !== outcome.domain) ||
        (outcome.action !== 'quarantine' && outcome.action !== 'close') ||
        (outcome.result !== 'confirmed' && outcome.result !== 'failed') ||
        !Number.isSafeInteger(outcome.timestamp) || outcome.timestamp < 0 || outcome.timestamp > this.now()) throw new Error('Invalid emergency outcome');
      return { tabId: outcome.tabId, domain: outcome.domain, action: outcome.action, result: outcome.result, timestamp: outcome.timestamp };
    });
    // Saved tab IDs are historical outcomes only, never action targets after restart.
    this.state = { schemaVersion: 1, active: raw.active, activatedAt: raw.activatedAt ?? null, outcomes, grantsRevoked: raw.grantsRevoked === true };
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(work);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
  private async perform(tab: TabAgentStatus, action: 'quarantine' | 'close'): Promise<void> {
    if (!hasAutomation(tab.status) || tab.expiresAt <= this.now() || tab.domain === null) return;
    let result: 'confirmed' | 'failed' = 'confirmed';
    try { await this.port.act(tab, action); } catch { result = 'failed'; }
    this.state.outcomes = [...this.state.outcomes, { tabId: tab.tabId, domain: tab.domain, action, result, timestamp: this.now() }].slice(-500);
    await this.port.write(this.state);
  }
  activate(action: 'quarantine' | 'close'): Promise<EmergencyState> {
    return this.serialize(async () => {
      const next: EmergencyState = { schemaVersion: 1, active: true, activatedAt: this.now(), outcomes: [], grantsRevoked: false };
      await this.port.write(next);
      this.state = next;
      // A cleanup failure must not prevent attempts on the remaining live tabs.
      try { await this.port.revokeGrants(); this.state.grantsRevoked = true; } catch { /* Visible in the persisted/readable latch state. */ }
      const targets = this.port.assessments().filter(tab => hasAutomation(tab.status)).slice(0, 500);
      let persistenceFailed = false;
      for (const tab of targets) try { await this.perform(tab, action); } catch { persistenceFailed = true; }
      try { await this.port.write(this.state); } catch { persistenceFailed = true; }
      if (persistenceFailed) throw new Error('Emergency outcomes could not all be saved');
      return this.snapshot();
    });
  }
  enforce(tab: TabAgentStatus): Promise<void> {
    return this.serialize(async () => { if (this.state.active) await this.perform(tab, 'quarantine'); });
  }
  reset(): Promise<EmergencyState> {
    return this.serialize(async () => {
      const next = { ...this.state, active: false };
      await this.port.write(next); this.state = next;
      return this.snapshot();
    });
  }
  snapshot(): EmergencyState { return structuredClone(this.state); }
}
