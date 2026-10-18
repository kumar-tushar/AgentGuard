import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_ACTIVITY_WINDOW_MS, AgentSessionStore, MAX_AGENT_SESSIONS, MAX_SESSION_TIMELINE,
  parseAgentSession, SAFE_TIMELINE_DESCRIPTIONS, type AgentSessionData, type AgentSessionPort,
} from '../src/background/agent-sessions';
import {
  attributeActivity, emptyActivity, mayEnforce, unknownIdentity,
  type AgentSession, type IntelligenceObservation,
} from '../src/shared/intelligence';

const START = 1_000_000;
const DAY = 86_400_000;
function observation(tabId = 1, observedAt = START, patch: Partial<IntelligenceObservation> = {}): IntelligenceObservation {
  return {
    tabId, domain: 'example.com', controlState: 'AGENT_ACTIVE', controller: unknownIdentity(),
    automationStack: { transports: ['CDP', 'WebDriver'], frameworks: [], environmentHints: [], controllerCandidates: [] },
    controlScore: 0.92, frameworkConfidence: 0, coverageScore: 1,
    evidenceIds: ['webdriver:webdriver', 'debugger:attached'], observedAt, expiresAt: observedAt + 90_000,
    lastActivityAt: observedAt, activityDelta: { ...emptyActivity(), pointerInteractions: 1 }, ...patch,
  };
}
function saved(tabId = 1, observedAt = START): AgentSession {
  const { observedAt: lastObservedAt, activityDelta: observedActivity, ...input } = observation(tabId, observedAt);
  return { ...input, id: crypto.randomUUID(), startedAt: observedAt, lastObservedAt,
    endedAt: null, endReason: null, active: true, observedActivity,
    timeline: [{ id: crypto.randomUUID(), timestamp: observedAt, kind: 'INFERRED', type: 'session_started',
      description: SAFE_TIMELINE_DESCRIPTIONS.session_started }] };
}
function memory(session: unknown = undefined, history: unknown = undefined) {
  const data = { session, history };
  const port = {
    readSession: vi.fn(async () => structuredClone(data.session)),
    readHistory: vi.fn(async () => structuredClone(data.history)),
    writeSession: vi.fn(async (next: AgentSessionData) => { data.session = structuredClone(next); }),
    writeHistory: vi.fn(async (next: AgentSessionData) => { data.history = structuredClone(next); }),
  } satisfies AgentSessionPort;
  return { data, port };
}
const envelope = (sessions: AgentSession[]): AgentSessionData => ({ schemaVersion: 1, sessions });

describe('AgentSessionStore lifecycle', () => {
  it('rejects behavioral-only live positive observations without recording a session', async () => {
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => START });
    await expect(store.observe(observation(1, START, { controlState: 'AUTOMATION_SUSPECTED', controlScore: 0.18,
      evidenceIds: ['behavior:regular-timing', 'behavior:synthetic-interactions'],
    }))).rejects.toThrow('Invalid intelligence observation');
    expect(store.snapshot(START)).toEqual([]);
    expect(port.writeSession).not.toHaveBeenCalled();
  });

  it('retires restored behavioral-only active sessions but preserves historical records and genuine active sessions', async () => {
    const legacy = { ...saved(), controlState: 'AUTOMATION_SUSPECTED' as const, controlScore: 0.18,
      evidenceIds: ['behavior:regular-timing'], automationStack: { transports: [], frameworks: [], environmentHints: [], controllerCandidates: [] } };
    const genuine = saved(2);
    const { port } = memory(envelope([legacy, genuine]));
    const store = new AgentSessionStore(port, { now: () => START + 1 });
    await store.load(new Set([1, 2]));
    expect(store.snapshot(START + 1).map(item => item.id)).toEqual([genuine.id]);
    expect(store.history()).toContainEqual(expect.objectContaining({ id: legacy.id, active: false, endReason: 'no_evidence' }));
    const restored = new AgentSessionStore(port, { now: () => START + 2 });
    await restored.load(new Set([1, 2]));
    expect(restored.snapshot(START + 2).map(item => item.id)).toEqual([genuine.id]);
    expect(restored.history().filter(item => item.id === legacy.id)).toHaveLength(1);
  });

  it('creates a tab-scoped unknown-controller session without retaining mutable caller references', async () => {
    const { port, data } = memory();
    const store = new AgentSessionStore(port, { now: () => START });
    const input = observation();
    const pending = store.observe(input);
    input.domain = 'changed.example';
    input.activityDelta.pointerInteractions = 900;
    input.evidenceIds.length = 0;
    const first = (await pending)!;
    expect(first).toMatchObject({ tabId: 1, domain: 'example.com', controlState: 'AGENT_ACTIVE',
      controller: unknownIdentity(), active: true, endedAt: null, observedActivity: { pointerInteractions: 1 } });
    expect(first.timeline.map(item => item.type)).toEqual(['session_started', 'session_active']);
    first.controller.displayName = 'spoof';
    first.observedActivity.pointerInteractions = 100;
    expect(store.snapshot(START)[0]?.controller.displayName).toBeNull();
    expect(store.snapshot(START)[0]?.observedActivity.pointerInteractions).toBe(1);
    expect(parseAgentSession((data.session as AgentSessionData).sessions[0], START)).not.toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/spoof|changed\.example/u);
  });

  it('moves ACTIVE to CONNECTED at 30 seconds, then expires evidence at its original TTL', async () => {
    let now = START;
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => now });
    const first = (await store.observe(observation()))!;
    expect(store.snapshot(START + ACTIVE_ACTIVITY_WINDOW_MS - 1)[0]?.controlState).toBe('AGENT_ACTIVE');
    now += ACTIVE_ACTIVITY_WINDOW_MS;
    expect(store.snapshot(now)[0]?.controlState).toBe('AGENT_CONNECTED');
    await store.expire(now);
    expect(store.snapshot(now)[0]?.timeline.at(-1)?.type).toBe('session_connected');
    now = START + 90_001;
    await store.expire(now);
    expect(store.snapshot(now)).toEqual([]);
    expect(store.history()).toHaveLength(1);
    expect(store.history()[0]).toMatchObject({ id: first.id, active: false, endedAt: START + 90_000,
      endReason: 'evidence_expired', controlState: 'AGENT_CONNECTED' });
  });

  it('records observed deltas, navigation, background activity and coverage changes without agent attribution', async () => {
    let now = START;
    const store = new AgentSessionStore(memory().port, { now: () => now });
    const first = (await store.observe(observation()))!;
    now += 10;
    const next = (await store.observe(observation(1, now, { coverageScore: 0.5,
      evidenceIds: ['webdriver:webdriver', 'debugger:attached', 'behavior:background-interaction'],
      activityDelta: { ...emptyActivity(), navigations: 1, keyboardInteractions: 2 } })))!;
    expect(next.id).toBe(first.id);
    expect(next.observedActivity).toEqual({ ...emptyActivity(), pointerInteractions: 1, navigations: 1, keyboardInteractions: 2 });
    expect(next.timeline.slice(-4).map(item => item.type)).toEqual([
      'evidence_updated', 'coverage_changed', 'navigation_observed', 'background_interaction',
    ]);
    expect(next.timeline.at(-1)?.kind).toBe('OBSERVED');
    expect(next.controller).toEqual(unknownIdentity());
    expect(next.timeline.every(item => !item.description.includes('Agent action'))).toBe(true);
  });

  it('does not duplicate activity for repeated or out-of-order observations, including after worker restart', async () => {
    let now = START;
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => now });
    const first = (await store.observe(observation()))!;
    now += 10;
    await store.observe(observation(1, now));
    const restored = new AgentSessionStore(port, { now: () => now });
    await restored.load(new Set([1]));
    await restored.observe(observation(1, now));
    await restored.observe(observation(1, START, { domain: 'stale.example' }));
    expect(restored.snapshot(now)[0]).toMatchObject({ id: first.id, lastObservedAt: now,
      domain: 'example.com', observedActivity: { pointerInteractions: 2 } });
  });

  it('ends on no evidence, prevents stale resurrection, and starts a new ID for later evidence', async () => {
    let now = START;
    const store = new AgentSessionStore(memory().port, { now: () => now });
    const first = (await store.observe(observation()))!;
    now++;
    await store.observe(observation(1, now, { controlState: 'NO_AUTOMATION_OBSERVED', controlScore: 0, evidenceIds: [] }));
    expect(store.snapshot(now)).toEqual([]);
    expect(store.history()[0]).toMatchObject({ id: first.id, endReason: 'no_evidence', endedAt: now });
    expect(await store.observe(observation(1, START))).toBeNull();
    now++;
    const next = (await store.observe(observation(1, now)))!;
    expect(next.id).not.toBe(first.id);
    expect(store.history()).toHaveLength(1);
  });

  it('starts a new session when a later observation follows evidence expiry', async () => {
    let now = START;
    const store = new AgentSessionStore(memory().port, { now: () => now });
    const first = (await store.observe(observation()))!;
    now += 90_000;
    const next = (await store.observe(observation(1, now)))!;
    expect(next.id).not.toBe(first.id);
    expect(store.history()[0]).toMatchObject({ id: first.id, endedAt: now, endReason: 'evidence_expired' });
    expect(next.observedActivity.pointerInteractions).toBe(1);
  });

  it('preserves a known recent activity timestamp if a later sample omits it', async () => {
    let now = START;
    const store = new AgentSessionStore(memory().port, { now: () => now });
    await store.observe(observation());
    now++;
    await store.observe(observation(1, now, { lastActivityAt: null, activityDelta: emptyActivity() }));
    expect(store.snapshot(now)[0]).toMatchObject({ controlState: 'AGENT_ACTIVE', lastActivityAt: START });
    expect(parseAgentSession(store.snapshot(now)[0], now)).not.toBeNull();
  });

  it('drops already-expired observations and rejects future observations', async () => {
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => START + 90_000 });
    expect(await store.observe(observation())).toBeNull();
    await expect(store.observe(observation(1, START + 90_001))).rejects.toThrow('Future');
    expect(store.snapshot(START + 90_000)).toEqual([]);
    expect(port.writeSession).not.toHaveBeenCalled();
  });

  it('does not treat unavailable monitoring as negative evidence or refresh the prior observation TTL', async () => {
    let now = START;
    const store = new AgentSessionStore(memory().port, { now: () => now });
    const first = (await store.observe(observation()))!;
    const unavailable = { controlState: 'UNMONITORED' as const, evidenceIds: [], coverageScore: 0, controlScore: 0 };
    expect(await store.observe(observation(1, now, unavailable))).toBeNull();
    now++;
    expect(await store.observe(observation(1, now, unavailable))).toBeNull();
    expect(await store.observe(observation(2, now, unavailable))).toBeNull();
    expect(store.snapshot(now)).toHaveLength(1);
    expect(store.snapshot(now)[0]).toMatchObject({ id: first.id, lastObservedAt: START, expiresAt: START + 90_000 });
    expect(store.history()).toEqual([]);
    now = START + 90_000;
    await store.expire(now);
    expect(store.snapshot(now)).toEqual([]);
    expect(store.history()[0]?.endReason).toBe('evidence_expired');
  });

  it('allows framework-only evidence without claiming any controller identity', async () => {
    const store = new AgentSessionStore(memory().port, { now: () => START });
    const result = await store.observe(observation(1, START, {
      controller: { ...unknownIdentity(), attributionLevel: 'FRAMEWORK_ONLY', evidenceIds: ['fingerprint:playwright-binding'] },
      frameworkConfidence: 0.5,
      automationStack: { transports: ['CDP'], frameworks: ['Playwright-like'], environmentHints: ['Linux platform'], controllerCandidates: [] },
      evidenceIds: ['debugger:attached', 'fingerprint:playwright-binding'],
    }));
    expect(result?.controller).toMatchObject({ attributionLevel: 'FRAMEWORK_ONLY', displayName: null, vendor: null,
      product: null, version: null, confidence: 0 });
  });
});

describe('strict session validation and privacy', () => {
  const invalidObservations: Array<[string, Record<string, unknown>]> = [
    ['page URL', { domain: 'https://example.com/private?token=secret' }],
    ['domain path', { domain: 'example.com/private' }], ['wildcard', { domain: '*.example.com' }],
    ['arbitrary top-level content', { password: 'secret' }], ['negative tab', { tabId: -1 }],
    ['oversized tab', { tabId: 2_147_483_648 }], ['fractional tab', { tabId: 1.1 }],
    ['unknown state', { controlState: 'HUMAN' }], ['empty positive evidence', { evidenceIds: [] }],
    ['arbitrary evidence text', { evidenceIds: ['page:password=secret'] }],
    ['duplicate evidence', { evidenceIds: ['debugger:attached', 'debugger:attached'] }],
    ['NaN score', { controlScore: Number.NaN }], ['infinite score', { controlScore: Number.POSITIVE_INFINITY }],
    ['oversized score', { coverageScore: 1.01 }], ['negative score', { frameworkConfidence: -1 }],
    ['negative time', { observedAt: -1 }], ['unsafe time', { observedAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['overlong expiry', { expiresAt: START + 90_001 }], ['empty expiry', { expiresAt: START }],
    ['future activity', { lastActivityAt: START + 1 }],
    ['arbitrary identity', { controller: { ...unknownIdentity(), displayName: 'Spoofed agent' } }],
    ['unverified vendor', { controller: { ...unknownIdentity(), vendor: 'Spoofed vendor' } }],
    ['unverified product', { controller: { ...unknownIdentity(), product: 'Spoofed product' } }],
    ['unverified version', { controller: { ...unknownIdentity(), version: '1.0' } }],
    ['verified claim', { controller: { ...unknownIdentity(), attributionLevel: 'VERIFIED' } }],
    ['controller confidence', { controller: { ...unknownIdentity(), confidence: 0.5 } }],
    ['nested identity content', { controller: { ...unknownIdentity(), token: 'secret' } }],
    ['negative activity', { activityDelta: { ...emptyActivity(), submits: -1 } }],
    ['fractional activity', { activityDelta: { ...emptyActivity(), submits: 0.1 } }],
    ['unbounded activity', { activityDelta: { ...emptyActivity(), submits: 1_000_000_001 } }],
    ['form values', { activityDelta: { ...emptyActivity(), value: 'password' } }],
    ['arbitrary framework', { automationStack: { transports: [], frameworks: ['A named AI agent'], environmentHints: [], controllerCandidates: [] } }],
    ['arbitrary transport', { automationStack: { transports: ['Cookie secret'], frameworks: [], environmentHints: [], controllerCandidates: [] } }],
    ['controller candidates', { automationStack: { transports: [], frameworks: [], environmentHints: [], controllerCandidates: [unknownIdentity()] } }],
  ];
  it.each(invalidObservations)('rejects %s before any storage write', async (_name, patch) => {
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => START });
    await expect(store.observe({ ...observation(), ...patch } as IntelligenceObservation)).rejects.toThrow('Invalid intelligence observation');
    expect(port.writeSession).not.toHaveBeenCalled();
    expect(port.writeHistory).not.toHaveBeenCalled();
  });

  it('rejects malformed persisted chronology, timeline text, terminal state and arbitrary nested data', () => {
    const good = saved();
    const event = good.timeline[0]!;
    const invalid: Record<string, unknown>[] = [
      { id: 'page-supplied-session' }, { url: 'https://example.com/password' },
      { startedAt: START + 1 }, { lastObservedAt: START + 1 }, { expiresAt: START },
      { lastActivityAt: START + 1 }, { lastActivityAt: null }, { lastActivityAt: START - 30_000 },
      { endedAt: START - 1, active: false, endReason: 'closed' },
      { endedAt: START + 1, active: false, endReason: 'closed' },
      { endedAt: START, active: true, endReason: 'closed' }, { active: false },
      { endedAt: START, active: false, endReason: 'unknown' },
      { controller: { ...unknownIdentity(), product: 'claimed agent' } },
      { observedActivity: { ...emptyActivity(), inputValue: 'secret' } },
      { timeline: [] }, { timeline: [{ ...event, description: 'Password secret' }] },
      { timeline: [{ ...event, timestamp: START - 1 }] }, { timeline: [{ ...event, timestamp: START + 1 }] },
      { timeline: [{ ...event, type: 'custom_secret' }] }, { timeline: [{ ...event, kind: 'CERTAIN_AGENT_ACTION' }] },
      { timeline: [{ ...event, url: 'https://example.com/private' }] }, { timeline: [event, event] },
      { timeline: Array.from({ length: 101 }, () => ({ ...event, id: crypto.randomUUID() })) },
    ];
    expect(parseAgentSession(good, START)).toEqual(good);
    for (const patch of invalid) expect(parseAgentSession({ ...good, ...patch }, START), JSON.stringify(patch)).toBeNull();
    expect(parseAgentSession(good, Number.NaN)).toBeNull();
    expect(parseAgentSession(null, START)).toBeNull();
  });

  it('never attributes another tab, or a browser-wide unknown event, to the only session', () => {
    const sessions = [saved()];
    expect(attributeActivity(undefined, sessions)).toEqual({ state: 'UNKNOWN' });
    expect(attributeActivity(2, sessions)).toEqual({ state: 'UNKNOWN' });
    const sameTab = attributeActivity(1, sessions);
    expect(sameTab).toEqual({ state: 'PROBABLE', sessionId: sessions[0]!.id, confidence: 0.5 });
    expect(mayEnforce(sameTab)).toBe(false);
    expect(mayEnforce({ state: 'UNKNOWN' })).toBe(false);
    expect(attributeActivity(1, [...sessions, saved()])).toEqual({ state: 'UNKNOWN' });
  });
});

describe('session recovery, bounds and retention', () => {
  it('recovers active sessions, downgrades idle sessions and reconciles closed or expired tabs', async () => {
    const sessions = [saved(1), saved(2), saved(3)];
    sessions[2]!.expiresAt = START + 10;
    const now = START + 30_000;
    const { port } = memory(envelope(sessions));
    const store = new AgentSessionStore(port, { now: () => now });
    await store.load(new Set([1, 3]));
    expect(store.snapshot(now)).toHaveLength(1);
    expect(store.snapshot(now)[0]).toMatchObject({ id: sessions[0]!.id, controlState: 'AGENT_CONNECTED' });
    expect(store.history().map(item => [item.tabId, item.endReason, item.endedAt])).toEqual([
      [2, 'closed', now], [3, 'evidence_expired', START + 10],
    ]);
  });

  it('ends recovered sessions at a browser restart even if a reused tab ID is live', async () => {
    const { port } = memory(envelope([saved()]));
    const store = new AgentSessionStore(port, { now: () => START + 1 });
    await store.load(new Set([1]), true);
    expect(store.snapshot(START + 1)).toEqual([]);
    expect(store.history()[0]?.endReason).toBe('browser_restart');
  });

  it('archives durable active snapshots after a full browser restart without binding reused tab IDs', async () => {
    let now = START;
    const { port, data } = memory();
    const store = new AgentSessionStore(port, { now: () => now });
    const first = (await store.observe(observation()))!;
    expect(store.history()).toEqual([]);
    expect((data.history as AgentSessionData).sessions[0]).toMatchObject({ id: first.id, active: true });
    data.session = undefined;
    now++;
    const restarted = new AgentSessionStore(port, { now: () => now });
    await restarted.load(new Set([1]));
    expect(restarted.snapshot(now)).toEqual([]);
    expect(restarted.history()[0]).toMatchObject({ id: first.id, active: false, endReason: 'browser_restart', endedAt: now });
    const next = (await restarted.observe(observation(1, now, { domain: 'new.example' })))!;
    expect(next.id).not.toBe(first.id);
    expect(next).toMatchObject({ domain: 'new.example', observedActivity: { pointerInteractions: 1 } });
    const workerRestarted = new AgentSessionStore(port, { now: () => now });
    await workerRestarted.load(new Set([1]));
    expect(workerRestarted.snapshot(now)[0]?.id).toBe(next.id);
    expect(workerRestarted.history().map(item => item.id)).toEqual([first.id]);
  });

  it('bounds durable active recovery separately from ended history using the configured limit', async () => {
    let now = START;
    const { port, data } = memory();
    const options = { now: () => now, limits: () => ({ maxHistorySessions: 2, retentionDays: 7 }) };
    const store = new AgentSessionStore(port, options);
    for (let tabId = 1; tabId <= 3; tabId++) {
      await store.observe(observation(tabId, now));
      await store.endTab(tabId, 'closed', ++now);
    }
    for (let tabId = 4; tabId <= 6; tabId++) await store.observe(observation(tabId, ++now));
    const durable = (data.history as AgentSessionData).sessions;
    expect(durable).toHaveLength(4);
    expect(durable.filter(item => item.active).map(item => item.tabId)).toEqual([6, 5]);
    expect(store.history().map(item => item.tabId)).toEqual([3, 2]);
    data.session = undefined;
    const restarted = new AgentSessionStore(port, options);
    await restarted.load(new Set([4, 5, 6]));
    expect(restarted.snapshot(now)).toEqual([]);
    expect(restarted.history().map(item => [item.tabId, item.endReason])).toEqual([[6, 'browser_restart'], [5, 'browser_restart']]);
  });

  it('discards recovery snapshots outside retention instead of renewing them at restart', async () => {
    const now = START + DAY + 1;
    const { port, data } = memory(undefined, envelope([saved(1), saved(2, START + 1)]));
    const store = new AgentSessionStore(port, { now: () => now, limits: () => ({ maxHistorySessions: 50, retentionDays: 1 }) });
    await store.load(new Set([1, 2]));
    expect(store.history().map(item => item.tabId)).toEqual([2]);
    expect((data.history as AgentSessionData).sessions.map(item => item.tabId)).toEqual([2]);
  });

  it('persists no active recovery or history when history retention is disabled', async () => {
    const { port, data } = memory();
    const options = { now: () => START, limits: () => ({ maxHistorySessions: 0, retentionDays: 7 }) };
    const store = new AgentSessionStore(port, options);
    await store.observe(observation());
    expect((data.history as AgentSessionData).sessions).toEqual([]);
    const workerRestarted = new AgentSessionStore(port, options);
    await workerRestarted.load(new Set([1]));
    expect(workerRestarted.snapshot(START)).toHaveLength(1);
    data.session = undefined;
    // A previously enabled setting may leave older durable snapshots until the next successful write.
    data.history = envelope([saved()]);
    const browserRestarted = new AgentSessionStore(port, options);
    await browserRestarted.load(new Set([1]));
    expect(browserRestarted.snapshot(START)).toEqual([]);
    expect(browserRestarted.history()).toEqual([]);
    expect((data.history as AgentSessionData).sessions).toEqual([]);
  });

  it('validates durable recovery records and rejects duplicate identities, tabs and arbitrary page data', async () => {
    const first = saved(1);
    const { port, data } = memory(undefined, envelope([first, { ...first, tabId: 2 }, saved(1),
      { ...saved(3), domain: 'example.com/private' }, { ...saved(4), token: 'secret' } as AgentSession, saved(5)]));
    const store = new AgentSessionStore(port, { now: () => START });
    await store.load(new Set([1, 2, 3, 4, 5]));
    expect(store.snapshot(START)).toEqual([]);
    expect(store.history().map(item => item.tabId)).toEqual([1, 5]);
    expect(JSON.stringify(data)).not.toMatch(/private|secret/u);
  });

  it.each([null, { schemaVersion: 2, sessions: [saved()] }, { schemaVersion: 1, sessions: [saved()], token: 'secret' }])(
    'rejects malformed durable recovery envelopes', async history => {
      const { port, data } = memory(undefined, history);
      const store = new AgentSessionStore(port, { now: () => START });
      await store.load(new Set([1]));
      expect(store.history()).toEqual([]);
      expect((data.history as AgentSessionData).sessions).toEqual([]);
    },
  );

  it.each([null, envelope([])])('does not revive durable active records when the session area is present', async session => {
    const { port } = memory(session, envelope([saved()]));
    const store = new AgentSessionStore(port, { now: () => START });
    await store.load(new Set([1]));
    expect(store.snapshot(START)).toEqual([]);
    expect(store.history()).toEqual([]);
  });

  it('does not duplicate archives or change their timeline across repeated full restarts', async () => {
    const { port, data } = memory(undefined, envelope([saved()]));
    const store = new AgentSessionStore(port, { now: () => START + 1 });
    await store.load(new Set([1]));
    const history = store.history();
    data.session = undefined;
    const restarted = new AgentSessionStore(port, { now: () => START + 2 });
    await restarted.load(new Set([1]));
    expect(restarted.snapshot(START + 2)).toEqual([]);
    expect(restarted.history()).toEqual(history);
  });

  it('rejects corrupt schemas, duplicated IDs/tabs and page data while preserving valid records', async () => {
    const first = saved(1);
    const { port } = memory({ schemaVersion: 1, sessions: [null, first, { ...first, tabId: 2 }, saved(1),
      { ...saved(3), domain: 'example.com/private' }, saved(4)] }, { schemaVersion: 2, sessions: [saved(5)] });
    const store = new AgentSessionStore(port, { now: () => START });
    await store.load(new Set([1, 2, 3, 4, 5]));
    expect(store.snapshot(START).map(item => item.tabId)).toEqual([1, 4]);
    expect(store.history()).toEqual([]);
    for (const corrupt of [null, [], { schemaVersion: 1, sessions: null }, { schemaVersion: 1, sessions: [], token: 'secret' }]) {
      const damaged = new AgentSessionStore(memory(corrupt, corrupt).port, { now: () => START });
      await damaged.load(new Set([1]));
      expect(damaged.snapshot(START)).toEqual([]);
    }
  });

  it('retains 50 ended sessions by default, then removes them after seven days rather than evidence TTL', async () => {
    let now = START;
    const { port, data } = memory();
    const store = new AgentSessionStore(port, { now: () => now });
    for (let tabId = 1; tabId <= 55; tabId++) {
      await store.observe(observation(tabId, now));
      await store.endTab(tabId, 'closed', ++now);
    }
    expect(store.history()).toHaveLength(50);
    expect(store.history().map(item => item.tabId)).toEqual(Array.from({ length: 50 }, (_, index) => 55 - index));
    expect((data.history as AgentSessionData).sessions).toHaveLength(50);
    now += 100_000;
    expect(store.history()).toHaveLength(50);
    const latestEndedAt = store.history()[0]!.endedAt!;
    now = latestEndedAt + 7 * DAY;
    expect(store.history()).toHaveLength(1);
    now++;
    await store.expire(now);
    expect(store.history()).toEqual([]);
    expect((data.history as AgentSessionData).sessions).toEqual([]);
  });

  it('honors changed retention limits, supports zero history and clears persistent history without ending active sessions', async () => {
    let now = START;
    let limits = { maxHistorySessions: 3, retentionDays: 1 };
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => now, limits: () => limits });
    for (let tabId = 1; tabId <= 5; tabId++) {
      await store.observe(observation(tabId, now));
      await store.endTab(tabId, 'closed', ++now);
    }
    expect(store.history()).toHaveLength(3);
    await store.observe(observation(6, now));
    await store.clearHistory();
    const restored = new AgentSessionStore(port, { now: () => now, limits: () => limits });
    await restored.load(new Set([6]));
    expect(restored.history()).toEqual([]);
    expect(restored.snapshot(now).map(item => item.tabId)).toEqual([6]);
    limits = { maxHistorySessions: 0, retentionDays: 1 };
    await restored.endTab(6, 'monitoring_disabled', ++now);
    expect(restored.history()).toEqual([]);
    limits = { maxHistorySessions: 501, retentionDays: 1 };
    expect(() => restored.history()).toThrow('Invalid session retention limits');
  });

  it('does not immediately resurrect a delayed duplicate after ending with zero history', async () => {
    let now = START;
    const { port } = memory();
    const options = { now: () => now, limits: () => ({ maxHistorySessions: 0, retentionDays: 7 }) };
    const store = new AgentSessionStore(port, options);
    await store.observe(observation());
    await store.endTab(1, 'closed', ++now);
    const restored = new AgentSessionStore(port, options);
    await restored.load(new Set([1]));
    expect(await restored.observe(observation())).toBeNull();
    expect(restored.snapshot(now)).toEqual([]);
    expect(restored.history()).toEqual([]);
  });

  it('bounds each timeline at 100 entries and uses only fixed safe descriptions', async () => {
    let now = START;
    const store = new AgentSessionStore(memory().port, { now: () => now });
    const session = (await store.observe(observation()))!;
    for (let index = 0; index < 150; index++) await store.appendTimeline(session.id, 'OBSERVED', 'alert_shown', ++now);
    const result = store.snapshot(now)[0]!;
    expect(result.timeline).toHaveLength(MAX_SESSION_TIMELINE);
    expect(new Set(result.timeline.map(item => item.id)).size).toBe(MAX_SESSION_TIMELINE);
    expect(parseAgentSession(result, now)).not.toBeNull();
    expect(await store.appendTimeline(crypto.randomUUID(), 'OBSERVED', 'alert_shown', now)).toBe(false);
    await expect(store.appendTimeline(session.id, 'OBSERVED', 'page-secret' as 'alert_shown', now)).rejects.toThrow('Invalid timeline event');
  });

  it('caps active sessions at 500 without evicting another tab', async () => {
    const sessions = Array.from({ length: MAX_AGENT_SESSIONS }, (_, index) => saved(index + 1));
    const store = new AgentSessionStore(memory(envelope(sessions)).port, { now: () => START });
    await store.load(new Set(sessions.map(item => item.tabId)));
    expect(store.snapshot(START)).toHaveLength(MAX_AGENT_SESSIONS);
    await expect(store.observe(observation(501))).rejects.toThrow('Active session capacity');
    expect(store.snapshot(START)[0]?.id).toBe(sessions[0]!.id);
    expect(store.snapshot(START)).toHaveLength(MAX_AGENT_SESSIONS);
  });

  it('bounds terminal recovery batches even when corrupted storage contains 1000 live records', async () => {
    const sessions = Array.from({ length: 1_000 }, (_, index) => saved(index + 1));
    const { port, data } = memory(envelope(sessions));
    const store = new AgentSessionStore(port, { now: () => START });
    await store.load(new Set());
    expect(store.snapshot(START)).toEqual([]);
    expect((data.session as AgentSessionData).sessions).toHaveLength(MAX_AGENT_SESSIONS);
    expect((data.history as AgentSessionData).sessions).toHaveLength(50);
  });

  it.each([10, 50, 100])('recovers %i tab states with one read/write per storage area and no cross-tab merging', async count => {
    const sessions = Array.from({ length: count }, (_, index) => saved(index + 1));
    const { port } = memory(envelope(sessions));
    const store = new AgentSessionStore(port, { now: () => START });
    await store.load(new Set(sessions.map(item => item.tabId)));
    const snapshot = store.snapshot(START);
    expect(snapshot).toHaveLength(count);
    expect(new Set(snapshot.map(item => item.id)).size).toBe(count);
    expect(snapshot.reduce((total, item) => total + item.observedActivity.pointerInteractions, 0)).toBe(count);
    expect(port.readSession).toHaveBeenCalledTimes(1);
    expect(port.readHistory).toHaveBeenCalledTimes(1);
    expect(port.writeSession).toHaveBeenCalledTimes(1);
    expect(port.writeHistory).toHaveBeenCalledTimes(1);
    expect(port.writeSession.mock.calls[0]![0].sessions).toHaveLength(count);
    expect(attributeActivity(count + 1, snapshot)).toEqual({ state: 'UNKNOWN' });
  });

  it('saturates counters instead of overflowing or storing unbounded integers', async () => {
    let now = START;
    const store = new AgentSessionStore(memory().port, { now: () => now });
    await store.observe(observation(1, now, { activityDelta: { ...emptyActivity(), pointerInteractions: 1_000_000_000 } }));
    await store.observe(observation(1, ++now));
    expect(store.snapshot(now)[0]?.observedActivity.pointerInteractions).toBe(1_000_000_000);
  });
});

describe('serialized writes and partial-write recovery', () => {
  it('serializes concurrent observations without losing deltas or reusing another tab session', async () => {
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => START + 10 });
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => store.observe(observation(1, START + index))));
    expect(new Set(results.map(item => item?.id)).size).toBe(1);
    expect(store.snapshot(START + 10)[0]?.observedActivity.pointerInteractions).toBe(10);
    expect(port.writeSession).toHaveBeenCalledTimes(10);
    expect(port.writeHistory).toHaveBeenCalledTimes(10);
  });

  it('reports a failed first-area write, then retries before deduplicating the same observation', async () => {
    const { port, data } = memory();
    const store = new AgentSessionStore(port, { now: () => START });
    port.writeSession.mockRejectedValueOnce(new Error('session storage failed'));
    await expect(store.observe(observation())).rejects.toThrow('session storage failed');
    expect(port.writeHistory).not.toHaveBeenCalled();
    const result = await store.observe(observation());
    expect(result?.observedActivity.pointerInteractions).toBe(1);
    expect((data.session as AgentSessionData).sessions[0]?.observedActivity.pointerInteractions).toBe(1);
  });

  it.each([0, 50])('recovers a terminal transition if history write fails with a %i-session retention limit', async maxHistorySessions => {
    let now = START;
    const { port, data } = memory();
    const options = { now: () => now, limits: () => ({ maxHistorySessions, retentionDays: 7 }) };
    const store = new AgentSessionStore(port, options);
    const first = (await store.observe(observation()))!;
    port.writeHistory.mockRejectedValueOnce(new Error('local storage failed'));
    await expect(store.endTab(1, 'closed', ++now)).rejects.toThrow('local storage failed');
    expect((data.session as AgentSessionData).sessions[0]).toMatchObject({ id: first.id, active: false, endReason: 'closed' });
    const restored = new AgentSessionStore(port, options);
    await restored.load(new Set([1]));
    expect(restored.snapshot(now)).toEqual([]);
    expect(restored.history()).toHaveLength(maxHistorySessions === 0 ? 0 : 1);
    expect((data.history as AgentSessionData).sessions).toHaveLength(maxHistorySessions === 0 ? 0 : 1);
  });

  it('keeps a terminal recovery journal through a second interruption during load', async () => {
    const terminal = saved();
    terminal.endedAt = START;
    terminal.active = false;
    terminal.endReason = 'closed';
    const { port, data } = memory(envelope([terminal]));
    port.writeHistory.mockRejectedValueOnce(new Error('history unavailable'));
    const store = new AgentSessionStore(port, { now: () => START });
    await expect(store.load(new Set([1]))).rejects.toThrow('history unavailable');
    expect((data.session as AgentSessionData).sessions[0]?.endedAt).toBe(START);
    const restored = new AgentSessionStore(port, { now: () => START });
    await restored.load(new Set([1]));
    expect(restored.snapshot(START)).toEqual([]);
    expect(restored.history()).toHaveLength(1);
  });

  it('preserves a restart archive through a failed history write and subsequent worker recovery', async () => {
    const first = saved();
    const { port, data } = memory(undefined, envelope([first]));
    port.writeHistory.mockRejectedValueOnce(new Error('history unavailable'));
    const store = new AgentSessionStore(port, { now: () => START + 1 });
    await expect(store.load(new Set([1]))).rejects.toThrow('history unavailable');
    const terminal = (data.session as AgentSessionData).sessions[0]!;
    expect(terminal).toMatchObject({ id: first.id, active: false, endReason: 'browser_restart' });
    expect((data.history as AgentSessionData).sessions[0]?.active).toBe(true);
    const restored = new AgentSessionStore(port, { now: () => START + 2 });
    await restored.load(new Set([1]));
    expect(restored.snapshot(START + 2)).toEqual([]);
    expect(restored.history()).toEqual([terminal]);
    expect((data.history as AgentSessionData).sessions).toEqual([terminal]);
  });

  it('uses the last durable observation when a full restart removes a failed terminal-write journal', async () => {
    let now = START;
    const { port, data } = memory();
    const store = new AgentSessionStore(port, { now: () => now });
    const first = (await store.observe(observation()))!;
    port.writeHistory.mockRejectedValueOnce(new Error('history unavailable'));
    await expect(store.endTab(1, 'closed', ++now)).rejects.toThrow('history unavailable');
    data.session = undefined;
    now++;
    const restarted = new AgentSessionStore(port, { now: () => now });
    await restarted.load(new Set([1]));
    expect(restarted.snapshot(now)).toEqual([]);
    // The rejected transition was not durable; recovery must not fabricate knowledge of its outcome.
    expect(restarted.history()).toHaveLength(1);
    expect(restarted.history()[0]).toMatchObject({ id: first.id, endReason: 'browser_restart', lastObservedAt: START });
  });

  it('does not resurrect successfully cleared history after a full restart', async () => {
    let now = START;
    const { port, data } = memory();
    const store = new AgentSessionStore(port, { now: () => now });
    await store.observe(observation());
    await store.endTab(1, 'closed', ++now);
    const active = (await store.observe(observation(2, now)))!;
    await store.clearHistory();
    data.session = undefined;
    now++;
    const restarted = new AgentSessionStore(port, { now: () => now });
    await restarted.load(new Set([1, 2]));
    expect(restarted.snapshot(now)).toEqual([]);
    expect(restarted.history().map(item => item.id)).toEqual([active.id]);
  });

  it('reports a failed clear rather than promising deletion that survives a full restart', async () => {
    let now = START;
    const { port, data } = memory();
    const store = new AgentSessionStore(port, { now: () => now });
    const first = (await store.observe(observation()))!;
    await store.endTab(1, 'closed', ++now);
    port.writeHistory.mockRejectedValueOnce(new Error('history unavailable'));
    await expect(store.clearHistory()).rejects.toThrow('history unavailable');
    data.session = undefined;
    now++;
    const restarted = new AgentSessionStore(port, { now: () => now });
    await restarted.load(new Set([1]));
    expect(restarted.snapshot(now)).toEqual([]);
    // Only the successful durable state can survive loss of both the worker and session area.
    expect(restarted.history().map(item => item.id)).toEqual([first.id]);
  });

  it('does not accept more mutations during repeated write failures and recovers when storage returns', async () => {
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => START });
    port.writeSession.mockRejectedValueOnce(new Error('quota')).mockRejectedValueOnce(new Error('quota'));
    await expect(store.observe(observation(1))).rejects.toThrow('quota');
    await expect(store.observe(observation(2))).rejects.toThrow('quota');
    expect(store.snapshot(START).map(item => item.tabId)).toEqual([1]);
    await store.observe(observation(2));
    expect(store.snapshot(START).map(item => item.tabId)).toEqual([1, 2]);
  });

  it('does not erase in-memory state on a failed recovery read', async () => {
    const { port } = memory();
    const store = new AgentSessionStore(port, { now: () => START });
    await store.observe(observation());
    port.readHistory.mockRejectedValueOnce(new Error('read failed'));
    await expect(store.load(new Set([1]))).rejects.toThrow('read failed');
    expect(store.snapshot(START)).toHaveLength(1);
  });
});
