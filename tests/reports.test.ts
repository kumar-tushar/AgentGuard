import { describe, expect, it } from 'vitest';
import { summarizeSession } from '../src/session/reports';
import { StatisticsStore } from '../src/background/statistics';
import { emptyActivity, unknownIdentity, type AgentSession } from '../src/shared/intelligence';

function session(): AgentSession {
  return { id: crypto.randomUUID(), tabId: 1, domain: 'example.com', controlState: 'AUTOMATION_LIKELY', controller: unknownIdentity(),
    automationStack: { transports: ['WebDriver'], frameworks: ['Playwright-like'], environmentHints: [], controllerCandidates: [] },
    controlScore: 0.82, frameworkConfidence: 0.34, coverageScore: 1, startedAt: 1000, lastObservedAt: 2000, expiresAt: 92_000,
    lastActivityAt: 1900, endedAt: 2500, endReason: 'closed', active: false, evidenceIds: ['webdriver:webdriver'],
    observedActivity: { ...emptyActivity(), keyboardInteractions: 3 }, timeline: [{ id: crypto.randomUUID(), timestamp: 1000,
      kind: 'INFERRED', type: 'session_started', description: 'Automation observation session started' }] };
}
describe('session reports', () => {
  it('summarizes actual retained observations, duration and uncertainty without exposing arbitrary fields', () => {
    const input = session();
    const report = summarizeSession(input, 3000);
    expect(report).toMatchObject({ sessionId: input.id, controller: null, domain: 'example.com', observedDurationMs: 1500,
      activity: { keyboardInteractions: 3 }, coverageNote: expect.stringContaining('zero counts do not establish inactivity') });
    expect(report.coverageNote).toContain('not an exact controller connection duration');
    expect(() => summarizeSession({ ...input, domain: 'https://example.com/private?token=SECRET' }, 3000)).toThrow();
    expect(() => summarizeSession({ ...input, password: 'SECRET' } as AgentSession, 3000)).toThrow();
    expect(JSON.stringify(report)).not.toMatch(/SECRET|https:/);
  });
});
describe('lifetime statistics', () => {
  it('counts stable sessions once across reobservations and store reload, with separate confirmed outcomes', async () => {
    let saved: unknown;
    const port = { read: async () => saved, write: async (data: unknown) => { saved = structuredClone(data); } };
    const store = new StatisticsStore(port);
    const input = session();
    await Promise.all([store.record(input), store.record(input)]);
    expect(store.snapshot().sessionsObserved).toBe(1);
    const restored = new StatisticsStore(port);
    await restored.load(); await restored.record(input); await restored.containment();
    expect(restored.snapshot()).toMatchObject({ sessionsObserved: 1, confirmedContainments: 1, frameworks: { 'Playwright-like': 1 } });
    expect(JSON.stringify(saved)).not.toContain('example.com');
  });
  it('does not claim statistics persisted when writing fails', async () => {
    const store = new StatisticsStore({ read: async () => null, write: async () => { throw new Error('storage unavailable'); } });
    await expect(store.record(session())).rejects.toThrow();
    expect(store.snapshot().sessionsObserved).toBe(0);
  });
});
