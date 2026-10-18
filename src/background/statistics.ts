import type { AgentSession, Framework } from '../shared/intelligence';
import type { BrowserStatistics } from '../shared/reports';

interface Data { schemaVersion: 1; summary: BrowserStatistics; recentSessionIds: string[] }
const FRAMEWORKS: readonly Framework[] = ['Playwright-like', 'Puppeteer-like', 'Selenium-like', 'WebDriver-compatible'];
const defaults = (): Data => ({ schemaVersion: 1, summary: { firstSessionAt: null, sessionsObserved: 0, confirmedContainments: 0, frameworks: {} }, recentSessionIds: [] });
export class StatisticsStore {
  private data = defaults();
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly port: { read(): Promise<unknown>; write(data: Data): Promise<void> }) {}
  async load(): Promise<void> {
    const value = await this.port.read() as Data | undefined;
    const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= Number.MAX_SAFE_INTEGER;
    if (value === undefined) return;
    if (!value || value.schemaVersion !== 1 || !value.summary || !Array.isArray(value.recentSessionIds) || value.recentSessionIds.length > 1000 ||
      value.recentSessionIds.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/u.test(id)) ||
      !count(value.summary.sessionsObserved) || !count(value.summary.confirmedContainments) ||
      (value.summary.firstSessionAt !== null && !count(value.summary.firstSessionAt)) || !value.summary.frameworks ||
      Object.entries(value.summary.frameworks).some(([key, n]) => !FRAMEWORKS.includes(key as Framework) || !count(n))) throw new Error('Invalid lifetime statistics');
    // Rebuild every field; never forward arbitrary storage properties into the UI.
    this.data = { schemaVersion: 1, recentSessionIds: [...new Set(value.recentSessionIds)], summary: {
      firstSessionAt: value.summary.firstSessionAt, sessionsObserved: value.summary.sessionsObserved,
      confirmedContainments: value.summary.confirmedContainments, frameworks: Object.fromEntries(Object.entries(value.summary.frameworks)),
    } };
  }
  private update(change: (next: Data) => void): Promise<void> {
    const pending = this.queue.then(async () => {
      const next = structuredClone(this.data);
      change(next);
      await this.port.write(next);
      this.data = next;
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  record(session: AgentSession, newObservationSession = true): Promise<void> {
    if (this.data.recentSessionIds.includes(session.id)) return Promise.resolve();
    return this.update(next => {
      const known = next.recentSessionIds.includes(session.id);
      next.recentSessionIds = [...next.recentSessionIds.filter(id => id !== session.id), session.id].slice(-1000);
      if (known || !newObservationSession) return;
      next.summary.firstSessionAt ??= session.startedAt;
      next.summary.sessionsObserved = Math.min(Number.MAX_SAFE_INTEGER, next.summary.sessionsObserved + 1);
      for (const framework of new Set(session.automationStack.frameworks)) {
        if (FRAMEWORKS.includes(framework)) next.summary.frameworks[framework] = Math.min(Number.MAX_SAFE_INTEGER, (next.summary.frameworks[framework] ?? 0) + 1);
      }
    });
  }
  containment(): Promise<void> { return this.update(next => { next.summary.confirmedContainments = Math.min(Number.MAX_SAFE_INTEGER, next.summary.confirmedContainments + 1); }); }
  snapshot(): BrowserStatistics { return structuredClone(this.data.summary); }
}
