import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabMonitor, unknownStatus, type MonitorPort } from '../src/background/monitor';
import { SessionStore, type SessionData } from '../src/background/session';
import { DEFAULT_CONFIG } from '../src/enterprise/config';
import type { AgentGuardConfig, DetectionContext } from '../src/shared/contracts';

const NOW = 1_800_000_000_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function context(now = Date.now()): DetectionContext {
  return {
    now, runtime: { webdriver: true, fingerprints: [] }, behavior: null, debuggerAttached: true,
    runtimeReason: 'Runtime inspected', debuggerReason: 'Target inspected',
  };
}

function setup() {
  let config: AgentGuardConfig = { ...DEFAULT_CONFIG };
  const urls = new Map([[1, 'https://example.com/first'], [2, 'https://other.example/']]);
  const writes: SessionData[] = [];
  const write = vi.fn(async (data: SessionData) => { writes.push(data); });
  const store = new SessionStore({ async read() { return undefined; }, write });
  const getTab = vi.fn<MonitorPort['getTab']>(async (tabId) => {
    const url = urls.get(tabId);
    if (!url) throw new Error('Tab is closed');
    return { url };
  });
  const observe = vi.fn<MonitorPort['observe']>(async (_tabId, _behaviorEnabled, now) => context(now));
  const canObserve = vi.fn((url?: string) => Boolean(url?.startsWith('https://')));
  const isContainmentPage = (url?: string) => url === 'chrome-extension://agentguard/blocked.html';
  const onAssessment = vi.fn<MonitorPort['onAssessment']>(async () => undefined);
  const monitor = new TabMonitor(store, () => config, { getTab, observe, canObserve, isContainmentPage, onAssessment });
  return {
    monitor, store, urls, writes, write, getTab, observe, canObserve, onAssessment,
    setConfig(next: Partial<AgentGuardConfig>) { config = { ...config, ...next }; },
  };
}

describe('TabMonitor', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it('assesses actual detector signals with bounded confidence, evidence and policy', async () => {
    const state = setup();
    state.setConfig({ sensitiveDomains: ['example.com'], policyMode: 'block' });
    const result = await state.monitor.scan(1);
    expect(result).toMatchObject({ tabId: 1, domain: 'example.com', status: 'AUTOMATION_LIKELY', identifiedAgent: null,
      firstDetectedAt: NOW, lastDetectedAt: NOW, assessedAt: NOW, expiresAt: NOW + 90_000,
      policy: { action: 'quarantine', matchedDomain: 'example.com' } });
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.confidence).toBeLessThan(1);
    expect(result.evidence.map((item) => item.detector)).toEqual(['webdriver', 'debugger']);
    expect(state.writes.at(-1)?.tabs[1]).toEqual(result);
    expect(state.onAssessment).toHaveBeenCalledWith(result, undefined, expect.any(Function));
    expect(await state.onAssessment.mock.calls[0]![2]()).toBe(true);
  });

  it('coalesces concurrent scans throughout observation and the policy callback', async () => {
    const state = setup();
    const observing = deferred<void>();
    const observation = deferred<DetectionContext>();
    const applying = deferred<void>();
    const applied = deferred<void>();
    state.observe.mockImplementation(async () => { observing.resolve(); return observation.promise; });
    state.onAssessment.mockImplementation(async () => { applying.resolve(); await applied.promise; });
    const first = state.monitor.scan(1);
    const callers = Array.from({ length: 20 }, () => state.monitor.scan(1));
    expect(callers.every((task) => task === first)).toBe(true);
    await observing.promise;
    observation.resolve(context());
    await applying.promise;
    expect(state.monitor.scan(1)).toBe(first);
    applied.resolve();
    const results = await Promise.all([first, ...callers]);
    expect(results.every((result) => result === results[0])).toBe(true);
    expect(state.observe).toHaveBeenCalledTimes(1);
    expect(state.onAssessment).toHaveBeenCalledTimes(1);
  });

  it('queues exactly one replacement scan when navigation interrupts many callers', async () => {
    const state = setup();
    const observing = deferred<void>();
    const observation = deferred<DetectionContext>();
    state.observe.mockImplementationOnce(async () => { observing.resolve(); return observation.promise; });
    const first = state.monitor.scan(1);
    await observing.promise;
    state.urls.set(1, 'https://next.example/new-document');
    await state.monitor.invalidate(1);
    const replacement = state.monitor.scan(1);
    const callers = Array.from({ length: 20 }, () => state.monitor.scan(1));
    expect(callers.every((task) => task === replacement)).toBe(true);
    expect(state.observe).toHaveBeenCalledTimes(1);
    observation.resolve(context());
    expect(await first).toMatchObject({ status: 'UNMONITORED', evidence: [] });
    await Promise.all([replacement, ...callers]);
    expect(state.observe).toHaveBeenCalledTimes(2);
    expect(state.store.tabs.get(1)?.domain).toBe('next.example');
    expect(state.onAssessment).toHaveBeenCalledTimes(1);
    expect(state.writes.every((write) => write.tabs[1]?.domain !== 'example.com')).toBe(true);
  });

  it('skips obsolete queued generations without observing their documents', async () => {
    const state = setup();
    const observing = deferred<void>();
    const observation = deferred<DetectionContext>();
    state.observe.mockImplementationOnce(async () => { observing.resolve(); return observation.promise; });
    const first = state.monitor.scan(1);
    await observing.promise;
    await state.monitor.invalidate(1);
    const obsolete = state.monitor.scan(1);
    state.urls.set(1, 'https://final.example/');
    await state.monitor.invalidate(1);
    const final = state.monitor.scan(1);
    observation.resolve(context());
    const results = await Promise.all([first, obsolete, final]);
    expect(results.map((result) => result.status)).toEqual(['UNMONITORED', 'UNMONITORED', 'AUTOMATION_LIKELY']);
    expect(state.observe).toHaveBeenCalledTimes(2);
    expect(state.store.tabs.get(1)?.domain).toBe('final.example');
  });

  it('does not let a pending storage write or old callback overwrite a newer navigation', async () => {
    const state = setup();
    const writing = deferred<void>();
    const written = deferred<void>();
    state.write.mockImplementationOnce(async (data) => { state.writes.push(data); writing.resolve(); await written.promise; });
    const first = state.monitor.scan(1);
    await writing.promise;
    state.urls.set(1, 'https://next.example/');
    const invalidated = state.monitor.invalidate(1);
    const replacement = state.monitor.scan(1);
    expect(state.store.tabs.has(1)).toBe(false);
    written.resolve();
    await invalidated;
    expect((await first).status).toBe('UNMONITORED');
    const latest = await replacement;
    expect(state.writes.at(-1)?.tabs[1]).toEqual(latest);
    expect(latest.domain).toBe('next.example');
    expect(state.onAssessment).toHaveBeenCalledTimes(1);
    expect(state.onAssessment.mock.calls[0]?.[0]).toBe(latest);
  });

  it('rejects a same-domain URL change even before the navigation event arrives', async () => {
    const state = setup();
    await state.monitor.scan(1);
    state.onAssessment.mockClear();
    const observing = deferred<void>();
    const observation = deferred<DetectionContext>();
    state.observe.mockImplementationOnce(async () => { observing.resolve(); return observation.promise; });
    const scan = state.monitor.scan(1);
    await observing.promise;
    state.urls.set(1, 'https://example.com/different-path');
    observation.resolve(context());
    expect((await scan).status).toBe('UNMONITORED');
    expect(state.store.tabs.size).toBe(0);
    expect(state.onAssessment).not.toHaveBeenCalled();
    expect(state.writes.at(-1)?.tabs[1]).toBeUndefined();
  });

  it('captures configuration for every queued scan and discards an obsolete configuration', async () => {
    const state = setup();
    const observing = deferred<void>();
    const observation = deferred<DetectionContext>();
    state.observe.mockImplementationOnce(async () => { observing.resolve(); return observation.promise; });
    const first = state.monitor.scan(1);
    await observing.promise;
    state.setConfig({ behaviorEnabled: false });
    const replacement = state.monitor.scan(1);
    expect(replacement).not.toBe(first);
    observation.resolve(context());
    expect((await first).status).toBe('UNMONITORED');
    expect((await replacement).status).toBe('AUTOMATION_LIKELY');
    expect(state.observe).toHaveBeenLastCalledWith(1, false, NOW, undefined);
    expect(state.onAssessment).toHaveBeenCalledTimes(1);
  });

  it.each(['navigation', 'configuration', 'removal'] as const)('guards delayed enforcement after %s', async (change) => {
    const state = setup();
    const applying = deferred<void>();
    const applied = deferred<void>();
    const enforced = vi.fn();
    state.onAssessment.mockImplementation(async (_current, _previous, isCurrent) => {
      expect(await isCurrent()).toBe(true);
      applying.resolve();
      await applied.promise;
      if (await isCurrent()) enforced();
    });
    const scan = state.monitor.scan(1);
    await applying.promise;
    if (change === 'navigation') state.urls.set(1, 'https://example.com/changed');
    if (change === 'configuration') state.setConfig({ monitoringEnabled: false });
    if (change === 'removal') { state.urls.delete(1); await state.monitor.invalidate(1, true); }
    applied.resolve();
    expect((await scan).status).toBe('UNMONITORED');
    expect(enforced).not.toHaveBeenCalled();
    expect(state.store.tabs.has(1)).toBe(false);
    expect(state.writes.at(-1)?.tabs[1]).toBeUndefined();
  });

  it('invalidates synchronously without writing storage during initialization', async () => {
    const state = setup();
    state.store.tabs.set(1, unknownStatus(1, 'example.com', 'prior'));
    const record = { tabId: 1, domain: 'example.com', createdAt: NOW, reason: 'policy', networkBlocked: true };
    state.store.quarantines.set(1, record);
    const invalidated = state.monitor.invalidate(1, false, false);
    expect(state.store.tabs.has(1)).toBe(false);
    expect(state.store.quarantines.get(1)).toBe(record);
    await invalidated;
    expect(state.write).not.toHaveBeenCalled();
  });

  it('discards in-flight work on removal and releases generation bookkeeping when it finishes', async () => {
    const state = setup();
    const observing = deferred<void>();
    const observation = deferred<DetectionContext>();
    state.observe.mockImplementationOnce(async () => { observing.resolve(); return observation.promise; });
    const first = state.monitor.scan(1);
    await observing.promise;
    await state.monitor.invalidate(1);
    const queued = state.monitor.scan(1);
    state.urls.delete(1);
    await state.monitor.invalidate(1, true, false);
    observation.resolve(context());
    expect((await first).status).toBe('UNMONITORED');
    expect((await queued).status).toBe('UNMONITORED');
    expect(state.observe).toHaveBeenCalledTimes(1);
    expect(state.onAssessment).not.toHaveBeenCalled();
    expect(state.store.tabs.has(1)).toBe(false);
    expect(Reflect.get(state.monitor, 'generations').size).toBe(0);
    expect(Reflect.get(state.monitor, 'removed').size).toBe(0);
    expect(Reflect.get(state.monitor, 'running').size).toBe(0);
  });

  it('does not block another tab while one observation is pending', async () => {
    const state = setup();
    const observation = deferred<DetectionContext>();
    state.observe.mockImplementationOnce(() => observation.promise);
    const first = state.monitor.scan(1);
    const second = await state.monitor.scan(2);
    expect(second.domain).toBe('other.example');
    observation.resolve(context());
    await first;
    expect(state.store.tabs.size).toBe(2);
  });

  it('expires activity context independently without changing a negative runtime/debugger assessment', async () => {
    const state = setup();
    state.observe.mockResolvedValue({ ...context(), runtime: { webdriver: false, fingerprints: [] }, debuggerAttached: false,
      behavior: { trustedEvents: 1, syntheticEvents: 0, intervalSamples: 0, meanIntervalMs: 0, intervalVariance: 0,
        lastTrustedAt: NOW - 5_000, startedAt: NOW - 10_000 } });
    const result = await state.monitor.scan(1);
    expect(result.status).toBe('NO_AUTOMATION_OBSERVED');
    expect(result.expiresAt).toBe(NOW + 90_000);
    await state.monitor.expire(NOW + 25_000);
    expect(state.monitor.snapshot(NOW + 25_000)[0]).toMatchObject({ status: 'NO_AUTOMATION_OBSERVED', confidence: 0, evidence: [] });
    expect(state.monitor.snapshot(NOW + 90_000)[0]).toMatchObject({ status: 'UNMONITORED', confidence: 0, evidence: [] });
  });

  it('does not shorten genuine automation evidence or policy when activity context expires', async () => {
    const state = setup();
    state.setConfig({ sensitiveDomains: ['example.com'], policyMode: 'warn' });
    state.observe.mockResolvedValue({ ...context(), behavior: { trustedEvents: 1, syntheticEvents: 12, intervalSamples: 12,
      meanIntervalMs: 16, intervalVariance: 0, lastTrustedAt: NOW, startedAt: NOW - 1000 } });
    const result = await state.monitor.scan(1);
    expect(result.expiresAt).toBe(NOW + 90_000);
    expect(result.confidence).toBe(0.8884);
    await state.monitor.expire(NOW + 30_000);
    expect(state.monitor.snapshot(NOW + 30_000)[0]).toMatchObject({ status: 'AUTOMATION_LIKELY', confidence: 0.8884, policy: { action: 'warn' } });
    expect(state.store.tabs.get(1)?.evidence.map(item => item.detector)).toEqual(['webdriver', 'debugger']);
    expect(state.monitor.snapshot(NOW + 90_000)[0]?.status).toBe('UNMONITORED');
  });

  it('clears expired evidence and policy while retaining domains and independent quarantine records', async () => {
    const state = setup();
    const detected = await state.monitor.scan(1);
    state.store.tabs.set(2, { ...detected, tabId: 2, domain: 'other.example' });
    const quarantine = { tabId: 1, domain: 'example.com', createdAt: NOW, reason: 'policy', networkBlocked: true };
    state.store.quarantines.set(1, quarantine);
    const writeCount = state.write.mock.calls.length;
    const snapshots = state.monitor.snapshot(NOW + 90_000);
    expect(snapshots.map((tab) => tab.status)).toEqual(['UNMONITORED', 'UNMONITORED']);
    expect(state.write).toHaveBeenCalledTimes(writeCount);
    expect(state.store.tabs.get(1)?.status).toBe('AUTOMATION_LIKELY');
    await state.monitor.expire(NOW + 90_000);
    expect(state.store.tabs.get(1)).toMatchObject({ domain: 'example.com', status: 'UNMONITORED', confidence: 0,
      evidence: [], frameworkHints: [], firstDetectedAt: null, lastDetectedAt: null, policy: { action: 'none' } });
    expect(state.store.tabs.get(1)?.policy.reason).toMatch(/quarantined/);
    expect(state.store.tabs.get(2)?.policy.reason).toMatch(/expired/);
    expect(state.store.quarantines.get(1)).toEqual(quarantine);
    expect(state.writes.at(-1)?.tabs[1]?.evidence).toEqual([]);
    await state.monitor.expire(NOW + 90_001);
    expect(state.write).toHaveBeenCalledTimes(writeCount + 1);
  });

  it('also expires a restored assessment whose supporting evidence expired sooner than its stored expiry', async () => {
    const state = setup();
    const detected = await state.monitor.scan(1);
    state.store.tabs.set(1, { ...detected, evidence: detected.evidence.map((item) => ({ ...item, expiresAt: NOW + 1_000 })) });
    expect(state.monitor.snapshot(NOW + 1_000)[0]?.status).toBe('UNMONITORED');
    await state.monitor.expire(NOW + 1_000);
    expect(state.store.tabs.get(1)?.evidence).toEqual([]);
  });

  it('does not dispatch policy after evidence expires during persistence', async () => {
    const state = setup();
    const writing = deferred<void>();
    const written = deferred<void>();
    state.write.mockImplementationOnce(async (data) => { state.writes.push(data); writing.resolve(); await written.promise; });
    const scan = state.monitor.scan(1);
    await writing.promise;
    vi.setSystemTime(NOW + 90_000);
    written.resolve();
    expect((await scan).status).toBe('UNMONITORED');
    expect(state.onAssessment).not.toHaveBeenCalled();
    expect(state.store.tabs.has(1)).toBe(false);
  });

  it('keeps quarantine separate from current observations and skips page probes', async () => {
    const state = setup();
    state.store.quarantines.set(1, { tabId: 1, domain: 'protected.example', createdAt: NOW, reason: 'policy', networkBlocked: true });
    state.urls.set(1, 'chrome-extension://agentguard/blocked.html');
    expect(await state.monitor.scan(1)).toMatchObject({ status: 'UNMONITORED', domain: 'protected.example', evidence: [] });
    expect(state.observe).not.toHaveBeenCalled();
    expect(state.store.quarantines.has(1)).toBe(true);
  });

  it.each([false, true])('resumes observation after a quarantined tab leaves the containment page (network block: %s)', async (networkBlocked) => {
    const state = setup();
    expect((await state.monitor.scan(1)).status).toBe('AUTOMATION_LIKELY');
    const quarantine = { tabId: 1, domain: 'example.com', createdAt: NOW, reason: 'policy', networkBlocked };
    state.store.quarantines.set(1, quarantine);
    state.urls.set(1, 'https://escaped.example/');
    state.observe.mockResolvedValue({ ...context(), runtime: { webdriver: false, fingerprints: [] }, debuggerAttached: false });

    const result = await state.monitor.scan(1);

    expect(state.observe).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: 'NO_AUTOMATION_OBSERVED', domain: 'escaped.example', evidence: [],
      firstDetectedAt: null, lastDetectedAt: null });
    expect(result.coverage.find((item) => item.detector === 'webdriver')?.availability).toBe('available');
    expect(state.store.tabs.get(1)).toBe(result);
    expect(state.store.quarantines.get(1)).toBe(quarantine);
  });

  it('does not claim document containment when a quarantined tab URL is unavailable', async () => {
    const state = setup();
    state.store.quarantines.set(1, { tabId: 1, domain: 'example.com', createdAt: NOW, reason: 'policy', networkBlocked: false });
    state.getTab.mockResolvedValue({});

    const result = await state.monitor.scan(1);

    expect(result).toMatchObject({ status: 'UNMONITORED', domain: null, evidence: [] });
    expect(result.policy.reason).toMatch(/restricted|grant/);
    expect(result.policy.reason).not.toMatch(/quarantined/);
    expect(state.observe).not.toHaveBeenCalled();
    expect(state.store.quarantines.has(1)).toBe(true);
  });

  it.each(['disabled', 'restricted'] as const)('returns UNMONITORED without probing when monitoring is %s', async (mode) => {
    const state = setup();
    if (mode === 'disabled') state.setConfig({ monitoringEnabled: false });
    else state.urls.set(1, 'chrome://settings');
    expect(await state.monitor.scan(1)).toMatchObject({ status: 'UNMONITORED', confidence: 0, evidence: [] });
    expect(state.observe).not.toHaveBeenCalled();
  });

  it('retains the first detection only while a positive assessment for the current domain is fresh', async () => {
    const state = setup();
    await state.monitor.scan(1);
    vi.setSystemTime(NOW + 1_000);
    expect(await state.monitor.scan(1)).toMatchObject({ firstDetectedAt: NOW, lastDetectedAt: NOW + 1_000 });
    vi.setSystemTime(NOW + 100_000);
    expect((await state.monitor.scan(1)).firstDetectedAt).toBe(NOW + 100_000);
    state.urls.set(1, 'https://different.example/');
    await state.monitor.invalidate(1);
    vi.setSystemTime(NOW + 101_000);
    expect((await state.monitor.scan(1)).firstDetectedAt).toBe(NOW + 101_000);
  });

  it('replaces prior positive evidence with a visible coverage error after an observation fault', async () => {
    const state = setup();
    await state.monitor.scan(1);
    state.observe.mockRejectedValueOnce(new Error('private URL must not escape'));
    const result = await state.monitor.scan(1);
    expect(result).toMatchObject({ status: 'UNMONITORED', confidence: 0, evidence: [], policy: { action: 'none' } });
    expect(result.coverage.every((item) => item.availability === 'error')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private URL');
    expect(state.store.tabs.get(1)).toBe(result);
    expect((await state.monitor.scan(1)).status).toBe('AUTOMATION_LIKELY');
  });

  it('does not enforce or retain an unpublished assessment when persistence fails, and allows retry', async () => {
    const state = setup();
    state.write.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(state.monitor.scan(1)).rejects.toThrow('storage unavailable');
    expect(state.store.tabs.has(1)).toBe(false);
    expect(state.onAssessment).not.toHaveBeenCalled();
    expect((await state.monitor.scan(1)).status).toBe('AUTOMATION_LIKELY');
  });

  it('surfaces callback faults without leaving scans stuck', async () => {
    const state = setup();
    state.onAssessment.mockRejectedValueOnce(new Error('enforcement unavailable'));
    await expect(state.monitor.scan(1)).rejects.toThrow('enforcement unavailable');
    expect((await state.monitor.scan(1)).status).toBe('AUTOMATION_LIKELY');
    expect(state.onAssessment).toHaveBeenCalledTimes(2);
  });

  it('removes an old assessment when the tab can no longer be read', async () => {
    const state = setup();
    await state.monitor.scan(1);
    state.urls.delete(1);
    expect(await state.monitor.scan(1)).toMatchObject({ status: 'UNMONITORED', domain: null, evidence: [] });
    expect(state.store.tabs.has(1)).toBe(false);
    expect(state.writes.at(-1)?.tabs[1]).toBeUndefined();
  });
});
