import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DebuggerSnapshot } from '../src/background/browser';
import {
  DEBUGGER_OBSERVATION_TTL_MS, DebuggerIntelligenceStore, MAX_DEBUGGER_TARGETS, MAX_DEBUGGER_TRANSITIONS,
  parseDebuggerIntelligence, type DebuggerIntelligenceData, type DebuggerIntelligencePort,
} from '../src/background/debugger-intelligence';

const START = 1_000_000;
const domains = new Map<number, string | null>([[1, 'example.com'], [2, 'another.example']]);
const target = (id = 'target-1', tabId: number | undefined = 1, attached = true) => ({ id, type: 'page', tabId, attached });
const capture = (capturedAt = START, targets = [target()], available = true): DebuggerSnapshot => ({ capturedAt, targets, available, reason: 'PRIVATE_RAW_CHROME_REASON' });
function memory(initial: unknown = undefined) {
  const data = { value: initial };
  const port = { read: vi.fn(async () => structuredClone(data.value)), write: vi.fn(async (value: DebuggerIntelligenceData) => { data.value = structuredClone(value); }) } satisfies DebuggerIntelligencePort;
  return { data, port };
}
afterEach(() => vi.unstubAllGlobals());

describe('passive debugger target intelligence', () => {
  it('associates a newly identifiable tab domain without fabricating a new attachment sample', async () => {
    const { port } = memory();
    let now = START;
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    await store.reconcile(capture(), new Map());
    const before = store.snapshot().targets[0]!;
    now += 1000;
    await store.associateDomain(1, 'example.com');
    expect(store.snapshot().targets[0]).toMatchObject({ domain: 'example.com', lastSeen: before.lastSeen,
      sampledAttachmentSpanMs: before.sampledAttachmentSpanMs, timeline: before.timeline });
    now += DEBUGGER_OBSERVATION_TTL_MS;
    await store.associateDomain(1, 'next.example');
    expect(store.snapshot().targets[0]).toMatchObject({ currentAttached: null, observationFresh: false, lastSeen: START });
    await expect(store.associateDomain(1, 'https://private.example/path?token=secret')).rejects.toThrow();
  });
  it('records sampled attachment lifecycle with unknown owner and no Chrome calls', async () => {
    const chromeCalls = { getTargets: vi.fn(), attach: vi.fn(), sendCommand: vi.fn() };
    vi.stubGlobal('chrome', { debugger: chromeCalls });
    let now = START;
    const { port, data } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    await store.reconcile(capture(), domains);
    expect(store.snapshot()).toMatchObject({ coverageAvailable: true, lastCapturedAt: START, targets: [{
      targetId: 'target-1', type: 'page', tabId: 1, domain: 'example.com', owner: 'unknown', attached: true,
      firstSeen: START, lastSeen: START, lastObservedAttachedChange: START, disappearedAt: null,
      sampledAttachmentStartedAt: START, sampledAttachmentSpanMs: 0, currentAttached: true, observationFresh: true,
      timeline: [{ type: 'target_seen', timestamp: START }, { type: 'attachment_observed', timestamp: START }],
    }] });
    now += 2000;
    await store.reconcile(capture(now), domains);
    expect(store.snapshot().targets[0]).toMatchObject({ firstSeen: START, lastSeen: now, lastObservedAttachedChange: START,
      sampledAttachmentStartedAt: START, sampledAttachmentSpanMs: 2000 });
    now += 1000;
    await store.reconcile(capture(now, [target('target-1', 1, false)]), domains);
    expect(store.snapshot().targets[0]).toMatchObject({ attached: false, currentAttached: false, lastObservedAttachedChange: now,
      sampledAttachmentStartedAt: null, sampledAttachmentSpanMs: 0 });
    expect(store.snapshot().targets[0]?.timeline.at(-1)).toEqual({ type: 'detachment_observed', timestamp: now });
    expect(parseDebuggerIntelligence(data.value, now)).not.toBeNull();
    expect(chromeCalls.getTargets).not.toHaveBeenCalled();
    expect(chromeCalls.attach).not.toHaveBeenCalled();
    expect(chromeCalls.sendCommand).not.toHaveBeenCalled();
  });

  it('records disappearance only from successful snapshots and preserves historical flags', async () => {
    let now = START;
    const store = new DebuggerIntelligenceStore(memory().port, { now: () => now });
    await store.reconcile(capture(), domains);
    now += 10;
    await store.reconcile(capture(now, []), domains);
    expect(store.snapshot().targets[0]).toMatchObject({ attached: true, currentAttached: null, observationFresh: false,
      lastSeen: START, disappearedAt: now, lastObservedAttachedChange: START });
    expect(store.snapshot().targets[0]?.timeline.at(-1)?.type).toBe('target_disappeared');
    now += 10;
    await store.reconcile(capture(now, []), domains);
    expect(store.snapshot().targets[0]?.timeline.filter(event => event.type === 'target_disappeared')).toHaveLength(1);
    now += 10;
    await store.reconcile(capture(now), domains);
    expect(store.snapshot().targets[0]).toMatchObject({ firstSeen: START, lastSeen: now, disappearedAt: null,
      currentAttached: true, sampledAttachmentStartedAt: now, sampledAttachmentSpanMs: 0 });
    expect(store.snapshot().targets[0]?.timeline.at(-1)?.type).toBe('target_seen');
  });

  it('marks failed inspection unavailable without inventing detachment or disappearance and resets sampling on recovery', async () => {
    let now = START;
    const store = new DebuggerIntelligenceStore(memory().port, { now: () => now });
    await store.reconcile(capture(), domains);
    now += 100;
    await store.reconcile(capture(now), domains);
    now += 10;
    await store.reconcile(capture(now, [], false), domains);
    expect(store.snapshot()).toMatchObject({ coverageAvailable: false, targets: [{ attached: true, currentAttached: null,
      lastSeen: START + 100, disappearedAt: null, sampledAttachmentStartedAt: START, sampledAttachmentSpanMs: 100 }] });
    now += 10;
    await store.reconcile(capture(now, [], false), domains);
    expect(store.snapshot().targets[0]?.timeline.filter(event => event.type === 'coverage_lost')).toHaveLength(1);
    expect(store.snapshot().targets[0]?.timeline.some(event => event.type === 'detachment_observed' || event.type === 'target_disappeared')).toBe(false);
    now += 10;
    await store.reconcile(capture(now), domains);
    expect(store.snapshot().targets[0]).toMatchObject({ currentAttached: true, lastObservedAttachedChange: START,
      sampledAttachmentStartedAt: now, sampledAttachmentSpanMs: 0 });
    expect(store.snapshot().targets[0]?.timeline.at(-1)?.type).toBe('coverage_restored');
  });

  it('expires current attachment at90seconds without mutating historical state or extending span from wall time', async () => {
    let now = START;
    const { data, port } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    await store.reconcile(capture(), domains);
    const before = structuredClone(data.value);
    expect(store.snapshot(START + DEBUGGER_OBSERVATION_TTL_MS - 1).targets[0]?.currentAttached).toBe(true);
    expect(store.snapshot(START + DEBUGGER_OBSERVATION_TTL_MS)).toMatchObject({ coverageAvailable: false,
      targets: [{ currentAttached: null, attached: true, sampledAttachmentSpanMs: 0 }] });
    expect(data.value).toEqual(before);
    expect(port.write).toHaveBeenCalledTimes(1);
    now += DEBUGGER_OBSERVATION_TTL_MS;
    await store.reconcile(capture(now), domains);
    expect(store.snapshot().targets[0]).toMatchObject({ currentAttached: true, sampledAttachmentStartedAt: now, sampledAttachmentSpanMs: 0 });
  });

  it('ignores duplicate and stale snapshots, including after worker restart', async () => {
    let now = START;
    const { port } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    await store.reconcile(capture(), domains);
    now += 100;
    await store.reconcile(capture(now, [target('target-1', 1, false)]), domains);
    const restored = new DebuggerIntelligenceStore(port, { now: () => now });
    await restored.load();
    const before = restored.snapshot();
    await restored.reconcile(capture(now), new Map([[1, 'stale.example']]));
    await restored.reconcile(capture(START), domains);
    expect(restored.snapshot()).toEqual(before);
    expect(port.write).toHaveBeenCalledTimes(2);
  });

  it('keeps separate identities when a target ID is reused for a different tab or kind', async () => {
    let now = START;
    const store = new DebuggerIntelligenceStore(memory().port, { now: () => now });
    await store.reconcile(capture(), domains);
    now += 100;
    await store.reconcile(capture(now, [target('target-1', 2)]), domains);
    expect(store.snapshot().targets[0]).toMatchObject({ tabId: 2, domain: 'another.example', firstSeen: now, sampledAttachmentSpanMs: 0 });
    now += 100;
    await store.reconcile({ ...capture(now), targets: [{ id: 'target-1', type: 'service_worker', attached: false }] }, domains);
    expect(store.snapshot().targets[0]).toMatchObject({ type: 'service_worker', tabId: null, domain: null, firstSeen: now, attached: false });
  });

  it('refreshes canonical domain independently without inferring a debugger owner', async () => {
    let now = START;
    const store = new DebuggerIntelligenceStore(memory().port, { now: () => now });
    await store.reconcile(capture(), domains);
    now++;
    await store.reconcile(capture(now), new Map([[1, 'another.example']]));
    expect(store.snapshot().targets[0]).toMatchObject({ domain: 'another.example', owner: 'unknown', firstSeen: START });
    now++;
    await store.reconcile(capture(now), new Map());
    expect(store.snapshot().targets[0]?.domain).toBeNull();
  });

  it('clones queued input and returned views, and never retains raw URLs/titles/reasons/stack text', async () => {
    let now = START;
    const { port, data } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    const input = { ...capture(), targets: [{ ...target(), url: 'https://example.com/PRIVATE_PATH?token=PRIVATE_TOKEN', title: 'PRIVATE_TITLE', stack: 'PRIVATE_STACK' }] };
    const mapping = new Map([[1, 'example.com']]);
    const pending = store.reconcile(input, mapping);
    input.targets[0]!.attached = false;
    input.targets[0]!.id = 'changed';
    mapping.set(1, 'changed.example');
    await pending;
    const view = store.snapshot();
    view.targets[0]!.owner = 'spoof' as 'unknown';
    view.targets[0]!.timeline.length = 0;
    expect(store.snapshot().targets[0]).toMatchObject({ targetId: 'target-1', domain: 'example.com', attached: true, owner: 'unknown' });
    expect(store.snapshot().targets[0]?.timeline).toHaveLength(2);
    expect(JSON.stringify(data.value)).not.toMatch(/PRIVATE|changed|spoof|https:/u);
    now++;
    await store.reconcile({ ...capture(now, [], false), reason: 'PRIVATE_DENIAL' }, domains);
    expect(JSON.stringify(data.value)).not.toContain('PRIVATE');
  });

  it('bounds target history and per-target transitions, preferring live recent targets', async () => {
    let now = START;
    const { data, port } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    await store.reconcile(capture(now, Array.from({ length: MAX_DEBUGGER_TARGETS + 20 }, (_, index) => target(`target-${index}`, index))), new Map());
    expect(store.snapshot().targets).toHaveLength(MAX_DEBUGGER_TARGETS);
    now++;
    await store.reconcile(capture(now, [target('recent', 1)]), domains);
    expect(store.snapshot().targets).toHaveLength(MAX_DEBUGGER_TARGETS);
    expect(store.snapshot().targets[0]?.targetId).toBe('recent');
    for (let index = 0; index < MAX_DEBUGGER_TRANSITIONS + 5; index++) {
      now++;
      await store.reconcile(capture(now, [target('recent', 1, index % 2 === 0)]), domains);
    }
    expect(store.snapshot().targets[0]?.timeline).toHaveLength(MAX_DEBUGGER_TRANSITIONS);
    expect(parseDebuggerIntelligence(data.value, now)).not.toBeNull();
  });

  it('serializes persistence and retries failed writes without preserving a false current-coverage claim', async () => {
    let now = START;
    const { port, data } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    await store.reconcile(capture(), domains);
    now++;
    port.write.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(store.reconcile(capture(now, [], false), domains)).rejects.toThrow('Storage unavailable');
    expect(store.snapshot()).toMatchObject({ coverageAvailable: false, targets: [{ attached: true, currentAttached: null }] });
    await store.reconcile(capture(now, [], false), domains);
    expect(parseDebuggerIntelligence(data.value, now)?.coverageAvailable).toBe(false);
    now++;
    const first = store.reconcile(capture(now), domains);
    now++;
    const second = store.reconcile(capture(now, [target('target-1', 1, false)]), domains);
    await Promise.all([first, second]);
    expect(store.snapshot().targets[0]?.currentAttached).toBe(false);
    const restored = new DebuggerIntelligenceStore(port, { now: () => now });
    await restored.load();
    expect(restored.snapshot()).toEqual(store.snapshot());
  });

  it('loads unavailable and expired observations without granting current attachment coverage', async () => {
    let now = START;
    const { port } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    await store.reconcile(capture(), domains);
    now += DEBUGGER_OBSERVATION_TTL_MS;
    const expired = new DebuggerIntelligenceStore(port, { now: () => now });
    await expired.load();
    expect(expired.snapshot().targets[0]).toMatchObject({ attached: true, currentAttached: null });
    await expired.reconcile(capture(now, [], false), domains);
    const denied = new DebuggerIntelligenceStore(port, { now: () => now });
    await denied.load();
    expect(denied.snapshot()).toMatchObject({ coverageAvailable: false, targets: [{ disappearedAt: null, currentAttached: null }] });
  });

  it('applies newer coverage loss even when an earlier snapshot and all retries cannot be persisted', async () => {
    let now = START;
    const { port } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => now });
    port.write.mockRejectedValue(new Error('Storage unavailable'));
    await expect(store.reconcile(capture(), domains)).rejects.toThrow('Storage unavailable');
    now++;
    await expect(store.reconcile(capture(now, [], false), domains)).rejects.toThrow('Storage unavailable');
    expect(store.snapshot()).toMatchObject({ coverageAvailable: false, lastCapturedAt: now,
      targets: [{ attached: true, currentAttached: null, lastSeen: START, disappearedAt: null }] });
    port.write.mockResolvedValue(undefined);
    await store.reconcile(capture(now, [], false), domains);
    expect(port.write).toHaveBeenLastCalledWith(expect.objectContaining({ coverageAvailable: false, lastCapturedAt: now }));
  });

  it.each([
    { id: 'https://example.com/private' }, { id: 'x'.repeat(129) }, { id: '' },
    { type: 'PRIVATE_UNKNOWN_KIND' }, { tabId: -1 }, { tabId: 2_147_483_648 }, { attached: 'true' },
  ])('rejects invalid snapshot identifiers/types without retaining them: %j', async patch => {
    const { port } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => START });
    await expect(store.reconcile(capture(START, [{ ...target(), ...patch }] as DebuggerSnapshot['targets'] as ReturnType<typeof target>[]), domains)).rejects.toThrow(/Invalid debugger/u);
    expect(store.snapshot().targets).toEqual([]);
    expect(port.write).not.toHaveBeenCalled();
  });

  it.each(['https://example.com/private', '*.example.com', 'EXAMPLE.COM', 'example.com.', 'example.com/secret'])('rejects noncanonical domains: %s', async host => {
    const store = new DebuggerIntelligenceStore(memory().port, { now: () => START });
    await expect(store.reconcile(capture(), new Map([[1, host]]))).rejects.toThrow('Invalid debugger domain');
  });

  it('rejects duplicate targets, future/invalid captures and oversized input', async () => {
    const store = new DebuggerIntelligenceStore(memory().port, { now: () => START });
    await expect(store.reconcile(capture(START, [target(), target()]), domains)).rejects.toThrow('Invalid debugger target snapshot');
    await expect(store.reconcile(capture(START + 1), domains)).rejects.toThrow('Future debugger snapshot');
    await expect(store.reconcile(capture(NaN), domains)).rejects.toThrow('Invalid debugger snapshot');
    await expect(store.reconcile(capture(START, Array.from({ length: 10_001 }, (_, index) => target(`t-${index}`))), domains)).rejects.toThrow('Invalid debugger snapshot');
    expect(store.snapshot().targets).toEqual([]);
  });

  it('rejects unsupported persisted claims, corruption, oversized state and nested private fields', async () => {
    const { data, port } = memory();
    const store = new DebuggerIntelligenceStore(port, { now: () => START });
    await store.reconcile(capture(), domains);
    const valid = data.value as DebuggerIntelligenceData;
    const corruptions: unknown[] = [
      { ...valid, owner: 'Agent product' }, { ...valid, lastCapturedAt: START + 1 },
      { ...valid, targets: [...valid.targets, ...valid.targets] },
      { ...valid, targets: Array.from({ length: MAX_DEBUGGER_TARGETS + 1 }, () => valid.targets[0]) },
      ...[
        { owner: 'Verified agent' }, { firstSeen: START + 1 }, { lastSeen: START + 1 },
        { lastObservedAttachedChange: START + 1 }, { disappearedAt: START },
        { sampledAttachmentSpanMs: 10 }, { sampledAttachmentStartedAt: START + 1 },
        { tabId: null, domain: 'example.com' }, { url: 'PRIVATE_URL' },
        { timeline: [{ type: 'PRIVATE_EVENT', timestamp: START }] },
        { timeline: [{ type: 'target_seen', timestamp: START, description: 'PRIVATE_DETAIL' }] },
        { timeline: [{ type: 'target_seen', timestamp: START + 1 }] },
        { timeline: [] },
      ].map(patch => ({ ...valid, targets: [{ ...valid.targets[0], ...patch }] })),
    ];
    for (const corrupted of corruptions) {
      expect(parseDebuggerIntelligence(corrupted, START)).toBeNull();
      const loaded = new DebuggerIntelligenceStore(memory(corrupted).port, { now: () => START });
      await loaded.load();
      expect(loaded.snapshot()).toEqual({ coverageAvailable: false, lastCapturedAt: null, targets: [] });
    }
  });

  it('has an unavailable empty baseline and treats clock rollback as unavailable without mutating data', async () => {
    const store = new DebuggerIntelligenceStore(memory().port, { now: () => START });
    await store.load();
    expect(store.snapshot()).toEqual({ coverageAvailable: false, lastCapturedAt: null, targets: [] });
    await store.reconcile(capture(), domains);
    expect(store.snapshot(START - 1)).toMatchObject({ coverageAvailable: false, targets: [{ currentAttached: null }] });
    expect(() => store.snapshot(NaN)).toThrow('Invalid debugger observation clock');
    expect(store.snapshot().targets[0]?.currentAttached).toBe(true);
  });
});
