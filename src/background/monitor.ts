import type { AgentGuardConfig, DetectionContext, TabAgentStatus } from '../shared/contracts';
import { domainFromUrl } from '../shared/domains';
import { assess } from '../detection/engine';
import { assessmentDeadline } from '../detection/evidence';
import { evaluatePolicy } from '../policy/evaluate';
import type { SessionStore } from './session';
import { hasAutomation } from '../shared/intelligence';
import type { DebuggerSnapshot } from './browser';

const DETECTORS = ['webdriver', 'fingerprint', 'debugger', 'behavior'] as const;
export function unknownStatus(tabId: number, domain: string | null, reason: string, now = Date.now()): TabAgentStatus {
  return {
    tabId, domain, status: 'UNMONITORED', identifiedAgent: null, frameworkHints: [], confidence: 0,
    evidence: [], coverage: DETECTORS.map((detector) => ({ detector, availability: 'unavailable', reason })),
    firstDetectedAt: null, lastDetectedAt: null, assessedAt: now, expiresAt: now + 90_000,
    policy: { action: 'none', matchedDomain: null, reason },
  };
}

export interface MonitorPort {
  getTab(tabId: number): Promise<{ url?: string }>;
  canObserve(url?: string): boolean;
  isContainmentPage(url?: string): boolean;
  observe(tabId: number, behaviorEnabled: boolean, now: number, debuggerSnapshot?: DebuggerSnapshot): Promise<DetectionContext>;
  onAssessment(current: TabAgentStatus, previous: TabAgentStatus | undefined, isCurrent: () => Promise<boolean>): Promise<void>;
}

/** Navigation generations prevent old-document observations from affecting a new page. */
export class TabMonitor {
  private generations = new Map<number, number>();
  private running = new Map<number, { generation: number; config: AgentGuardConfig; task: Promise<TabAgentStatus> }>();
  private removed = new Set<number>();
  constructor(private readonly store: SessionStore, private readonly config: () => AgentGuardConfig, private readonly port: MonitorPort) {}

  invalidate(tabId: number, removed = false, persist = true): Promise<void> {
    this.generations.set(tabId, (this.generations.get(tabId) ?? 0) + 1);
    if (removed) this.removed.add(tabId);
    else this.removed.delete(tabId);
    this.store.tabs.delete(tabId);
    const write = persist ? this.store.persist() : Promise.resolve();
    this.cleanupRemoved(tabId);
    return write;
  }

  scan(tabId: number, debuggerSnapshot?: DebuggerSnapshot): Promise<TabAgentStatus> {
    const generation = this.generations.get(tabId) ?? 0;
    const config = this.config();
    const previous = this.running.get(tabId);
    // Same-document callers share a result. After navigation, queue exactly one
    // new scan behind the previous generation instead of launching all waiters.
    if (previous?.generation === generation && previous.config === config) return previous.task;
    const work = async (): Promise<TabAgentStatus> => {
      if (previous) await previous.task.catch(() => undefined);
      return this.performScan(tabId, generation, config, debuggerSnapshot);
    };
    let task: Promise<TabAgentStatus>;
    task = work().finally(() => {
      if (this.running.get(tabId)?.task === task) {
        this.running.delete(tabId);
        this.cleanupRemoved(tabId);
      }
    });
    this.running.set(tabId, { generation, config, task });
    return task;
  }

  private cleanupRemoved(tabId: number): void {
    if (this.removed.has(tabId) && !this.running.has(tabId)) {
      this.removed.delete(tabId);
      this.generations.delete(tabId);
    }
  }

  private async performScan(tabId: number, generation: number, currentConfig: AgentGuardConfig, debuggerSnapshot?: DebuggerSnapshot): Promise<TabAgentStatus> {
    const now = Date.now();
    const prior = this.store.tabs.get(tabId);
    const discardPrior = async () => {
      if (prior && this.store.tabs.get(tabId) === prior) {
        this.store.tabs.delete(tabId);
        await this.store.persist();
      }
    };
    const matchesScan = () => !this.removed.has(tabId) &&
      (this.generations.get(tabId) ?? 0) === generation && this.config() === currentConfig;
    if (!matchesScan()) {
      return unknownStatus(tabId, null, 'Navigation or configuration changed before the scan began.', now);
    }
    let tab: { url?: string };
    try { tab = await this.port.getTab(tabId); }
    catch {
      if (matchesScan() && this.store.tabs.delete(tabId)) await this.store.persist();
      return unknownStatus(tabId, null, 'Tab is closed or inaccessible.', now);
    }
    const domain = domainFromUrl(tab.url);
    let next = unknownStatus(tabId, domain, 'No current observation is available.', now);
    const isCurrent = async (): Promise<boolean> => {
      if (!matchesScan() || next.expiresAt <= Date.now()) return false;
      try {
        const latest = await this.port.getTab(tabId);
        return matchesScan() && next.expiresAt > Date.now() && latest.url === tab.url;
      } catch { return false; }
    };
    const quarantine = this.store.quarantines.get(tabId);
    if (quarantine && this.port.isContainmentPage(tab.url)) {
      next = unknownStatus(tabId, quarantine.domain, 'Tab quarantined; the current document is not observed.', now);
    } else if (!currentConfig.monitoringEnabled) {
      next = unknownStatus(tabId, domain, 'Monitoring is disabled or configuration needs attention.', now);
    } else if (!this.port.canObserve(tab.url)) {
      next = unknownStatus(tabId, domain, 'This page is restricted by Chrome, or site access is withheld.', now);
    } else {
      if (!await isCurrent()) {
        await discardPrior();
        return unknownStatus(tabId, null, 'Document, configuration or evidence freshness changed before observation.');
      }
      try {
        const context = await this.port.observe(tabId, currentConfig.behaviorEnabled, now, debuggerSnapshot);
        const result = await assess(context);
        const positive = hasAutomation(result.status);
        const previous = this.store.tabs.get(tabId);
        next = {
          ...next, ...result,
          expiresAt: assessmentDeadline({ expiresAt: now + 90_000, evidence: result.evidence }),
          firstDetectedAt: positive ? (previous?.domain === domain && previous.expiresAt > now ? previous.firstDetectedAt : null) ?? now : null,
          lastDetectedAt: positive ? now : null,
        };
        next.policy = evaluatePolicy(next, currentConfig);
      } catch {
        next = unknownStatus(tabId, domain, 'Observation failed; no current evidence is available.', now);
        next.coverage = next.coverage.map((item) => ({ ...item, availability: 'error' }));
      }
    }
    if (!await isCurrent()) {
      await discardPrior();
      return unknownStatus(tabId, null, 'Document, configuration or evidence freshness changed during observation; automatic monitoring will reassess.');
    }
    const previous = this.store.tabs.get(tabId);
    this.store.tabs.set(tabId, next);
    if (this.store.tabs.size > 500) this.store.tabs.delete(this.store.tabs.keys().next().value!);
    try { await this.store.persist(); }
    catch (error) {
      if (this.store.tabs.get(tabId) === next) this.store.tabs.delete(tabId);
      throw error;
    }
    // Policy callbacks can await audit and enforcement. Pass the document-bound
    // guard so every delayed action can recheck the same tab and config version.
    if (!await isCurrent()) {
      if (this.store.tabs.get(tabId) === next) {
        this.store.tabs.delete(tabId);
        await this.store.persist();
      }
      return unknownStatus(tabId, null, 'Document, configuration or evidence freshness changed before policy evaluation.');
    }
    let current = false;
    try {
      await this.port.onAssessment(next, previous, isCurrent);
    } finally {
      current = await isCurrent();
      if (!current && this.store.tabs.get(tabId) === next) {
        this.store.tabs.delete(tabId);
        await this.store.persist();
      }
    }
    return current ? next : unknownStatus(tabId, null, 'Document, configuration or evidence freshness changed while applying policy; automatic monitoring will reassess.');
  }

  async expire(now = Date.now()): Promise<void> {
    let changed = false;
    for (const [tabId, tab] of this.store.tabs) {
      if (assessmentDeadline(tab) > now) {
        const evidence = tab.evidence.filter(item => item.expiresAt > now);
        if (evidence.length !== tab.evidence.length) {
          this.store.tabs.set(tabId, { ...tab, evidence });
          changed = true;
        }
        continue;
      }
      const reason = this.store.quarantines.has(tabId)
        ? 'Tab quarantined; prior observation expired.'
        : 'Evidence expired; awaiting automatic observation.';
      this.store.tabs.set(tabId, unknownStatus(tabId, tab.domain, reason, now));
      changed = true;
    }
    if (changed) await this.store.persist();
  }

  snapshot(now = Date.now()): TabAgentStatus[] {
    return [...this.store.tabs.values()].map((tab) => assessmentDeadline(tab) <= now
      ? unknownStatus(tab.tabId, tab.domain, this.store.quarantines.has(tab.tabId)
        ? 'Tab quarantined; prior observation expired.' : 'Evidence expired; awaiting automatic observation.', now)
      : tab);
  }
}
