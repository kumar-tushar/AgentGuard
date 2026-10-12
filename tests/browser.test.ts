import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilities, readTab } from '../src/background/browser';
import { assess } from '../src/detection/engine';
import { CONTROL_STATES } from '../src/shared/intelligence';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('minimal-permission Chrome adapter', () => {
  it('recognizes its containment document without requesting tabs permission', async () => {
    const contexts = vi.fn(async () => [{ documentUrl: 'chrome-extension://ours/blocked.html' }]);
    vi.stubGlobal('chrome', {
      tabs: { get: async () => ({ id: 1, status: 'complete' }) },
      runtime: { getContexts: contexts, getURL: (path: string) => `chrome-extension://ours/${path}`, ContextType: { TAB: 'TAB' } },
    });
    expect(await readTab(1)).toEqual({ url: 'chrome-extension://ours/blocked.html', status: 'complete' });
    expect(contexts).toHaveBeenCalledWith({ tabIds: [1], contextTypes: ['TAB'] });
  });
  it('keeps ungranted external URLs unknown', async () => {
    vi.stubGlobal('chrome', {
      tabs: { get: async () => ({ id: 1, status: 'complete' }) },
      runtime: { getContexts: async () => [], getURL: (path: string) => `chrome-extension://ours/${path}`, ContextType: { TAB: 'TAB' } },
    });
    expect((await readTab(1)).url).toBeUndefined();
  });
  it('requires both API and persistent host permission to advertise network blocking', async () => {
    const getAll = vi.fn(async () => ({ permissions: ['declarativeNetRequestWithHostAccess'], origins: [] as string[] }));
    vi.stubGlobal('chrome', { permissions: { getAll } });
    expect((await capabilities()).networkBlocking).toBe(false);
    getAll.mockResolvedValue({ permissions: ['declarativeNetRequestWithHostAccess'], origins: ['https://example.com/*'] });
    expect((await capabilities()).networkBlocking).toBe(true);
  });
});

describe('passive debugger access and reduced coverage', () => {
  beforeEach(() => vi.resetModules());

  function mockObservation(getTargets?: ReturnType<typeof vi.fn>) {
    const now = Date.now();
    const attach = vi.fn();
    const sendCommand = vi.fn();
    vi.stubGlobal('chrome', {
      permissions: { getAll: async () => ({ permissions: ['debugger'], origins: [] }) },
      debugger: getTargets ? { getTargets, attach, sendCommand } : undefined,
      scripting: { executeScript: async ({ world }: { world: string }) => [{
        frameId: 0, documentId: 'current-document',
        result: world === 'MAIN' ? { webdriver: false, fingerprints: [] } : {
          trustedEvents: 1, syntheticEvents: 0, intervalSamples: 0,
          meanIntervalMs: 0, intervalVariance: 0, lastTrustedAt: now, startedAt: now,
        },
      }] },
    });
    return { now, attach, sendCommand };
  }

  it('reports policy/API denial as lost coverage despite its declared permission and trusted activity', async () => {
    const getTargets = vi.fn().mockRejectedValue(new Error('Policy denied debugger: PRIVATE_DETAILS'));
    const { now, attach, sendCommand } = mockObservation(getTargets);
    const adapter = await import('../src/background/browser');
    expect((await adapter.capabilities()).debugger).toBe(false);
    const observation = await adapter.observe(7, true, now);
    expect(observation.debuggerAttached).toBeNull();
    const result = await assess(observation);
    expect(result.status).toBe('UNMONITORED');
    expect(result.confidence).toBe(0);
    expect(result.evidence).toEqual([expect.objectContaining({ detector: 'behavior', metadata: { signal: 'trusted-activity' } })]);
    expect(result.coverage).toContainEqual(expect.objectContaining({
      detector: 'debugger', availability: 'unavailable', reason: expect.stringContaining('Chrome or organization policy'),
    }));
    expect(JSON.stringify(result)).not.toContain('PRIVATE_DETAILS');
    expect(getTargets).toHaveBeenCalledTimes(1);
    expect(attach).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('handles an unavailable debugger API without disabling other detectors', async () => {
    const { now } = mockObservation();
    const adapter = await import('../src/background/browser');
    expect((await adapter.capabilities()).debugger).toBe(false);
    const result = await assess(await adapter.observe(7, true, now));
    expect(result.status).toBe('UNMONITORED');
    expect(result.coverage.find(item => item.detector === 'webdriver')?.availability).toBe('available');
    expect(result.coverage.find(item => item.detector === 'debugger')?.availability).toBe('unavailable');
  });

  it('bounds a stalled debugger API and reports reduced coverage rather than NO_AUTOMATION_OBSERVED', async () => {
    vi.useFakeTimers();
    const getTargets = vi.fn(() => new Promise<chrome.debugger.TargetInfo[]>(() => undefined));
    const { now } = mockObservation(getTargets);
    const adapter = await import('../src/background/browser');
    const pending = Promise.all([adapter.capabilities(), adapter.observe(7, true, now)]);
    await vi.advanceTimersByTimeAsync(2500);
    const [capability, observation] = await pending;
    expect(capability.debugger).toBe(false);
    expect(observation.debuggerAttached).toBeNull();
    expect((await assess(observation)).status).toBe('UNMONITORED');
    expect(getTargets).toHaveBeenCalledTimes(1);
  });

  it('shares a successful passive inspection and permits qualified NO_AUTOMATION_OBSERVED with full coverage', async () => {
    const getTargets = vi.fn().mockResolvedValue([{ id: 'target', type: 'page', tabId: 7, attached: false }]);
    const { now, attach, sendCommand } = mockObservation(getTargets);
    const adapter = await import('../src/background/browser');
    expect((await adapter.capabilities()).debugger).toBe(true);
    const observation = await adapter.observe(7, true, now);
    expect(observation.debuggerAttached).toBe(false);
    const result = await assess(observation);
    expect(result.status).toBe('NO_AUTOMATION_OBSERVED');
    expect(result.confidence).toBe(0);
    expect(getTargets).toHaveBeenCalledTimes(1);
    expect(attach).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('distinguishes browser-wide API access from coverage for a missing tab target', async () => {
    const { now } = mockObservation(vi.fn().mockResolvedValue([]));
    const adapter = await import('../src/background/browser');
    expect((await adapter.capabilities()).debugger).toBe(true);
    const result = await assess(await adapter.observe(7, true, now));
    expect(result.status).toBe('UNMONITORED');
    expect(result.coverage).toContainEqual({ detector: 'debugger', availability: 'unavailable', reason: 'No inspectable page target was returned.' });
  });

  it('recovers after a denial and detects later access loss when the short cache expires', async () => {
    vi.useFakeTimers();
    const getTargets = vi.fn().mockRejectedValueOnce(new Error('Denied'))
      .mockResolvedValueOnce([{ id: 'target', type: 'page', tabId: 7, attached: false }])
      .mockRejectedValue(new Error('Denied again'));
    const { now } = mockObservation(getTargets);
    const adapter = await import('../src/background/browser');
    expect((await adapter.capabilities()).debugger).toBe(false);
    expect((await adapter.capabilities(await adapter.captureDebuggerSnapshot(true))).debugger).toBe(true);
    expect((await assess(await adapter.observe(7, true, now))).status).toBe('NO_AUTOMATION_OBSERVED');
    await vi.advanceTimersByTimeAsync(2001);
    expect((await adapter.capabilities()).debugger).toBe(false);
    expect((await assess(await adapter.observe(7, true, Date.now()))).status).toBe('UNMONITORED');
    expect(getTargets).toHaveBeenCalledTimes(3);
  });

  it('shares one sanitized snapshot across 100 observations even beyond the cache lifetime', async () => {
    vi.useFakeTimers();
    const getTargets = vi.fn().mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({
      id: `target-${index}`, type: 'page', tabId: index + 1, attached: index % 2 === 0,
      url: 'https://private.example/secret?token=PRIVATE_TOKEN', title: 'PRIVATE_TITLE', extensionId: 'PRIVATE_EXTENSION',
    })));
    const { now, attach, sendCommand } = mockObservation(getTargets);
    const adapter = await import('../src/background/browser');
    const snapshot = await adapter.captureDebuggerSnapshot();
    expect(snapshot.available).toBe(true);
    expect(snapshot.capturedAt).toBe(now);
    expect(snapshot.targets).toHaveLength(100);
    expect(snapshot.targets[0]).toEqual({ id: 'target-0', type: 'page', tabId: 1, attached: true });
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE|url|title|extensionId/);
    for (let tabId = 1; tabId <= 100; tabId++) {
      await vi.advanceTimersByTimeAsync(50);
      const result = await adapter.observe(tabId, true, Date.now(), snapshot);
      expect(result.debuggerAttached).toBe(tabId % 2 === 1);
    }
    expect(Date.now() - snapshot.capturedAt).toBe(5000);
    expect((await adapter.capabilities(snapshot)).debugger).toBe(true);
    expect(getTargets).toHaveBeenCalledTimes(1);
    expect(attach).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
    await adapter.captureDebuggerSnapshot();
    expect(getTargets).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    {},
    [null],
    [{ id: 'target', type: 'page', tabId: 7 }],
    [{ id: 'target', type: 'page', tabId: 7, attached: 'false' }],
    [{ id: 'target', type: 'page', tabId: '7', attached: false }],
    [{ id: 'target', type: 'page', tabId: -1, attached: false }],
  ])('treats malformed debugger responses as unavailable, never as a negative result: %j', async (targets) => {
    const { now } = mockObservation(vi.fn().mockResolvedValue(targets));
    const adapter = await import('../src/background/browser');
    const snapshot = await adapter.captureDebuggerSnapshot();
    expect(snapshot.available).toBe(false);
    expect(snapshot.targets).toEqual([]);
    expect((await adapter.capabilities(snapshot)).debugger).toBe(false);
    const observation = await adapter.observe(7, true, now, snapshot);
    expect(observation.debuggerAttached).toBeNull();
    expect((await assess(observation)).status).toBe('UNMONITORED');
  });

  it('preserves lost runtime coverage while consuming a valid shared debugger snapshot', async () => {
    const { now } = mockObservation(vi.fn().mockResolvedValue([{ id: 'target', type: 'page', tabId: 7, attached: true }]));
    vi.spyOn(chrome.scripting, 'executeScript').mockRejectedValue(new Error('Page unavailable'));
    const adapter = await import('../src/background/browser');
    const snapshot = await adapter.captureDebuggerSnapshot();
    const observation = await adapter.observe(7, true, now, snapshot);
    expect(observation.runtime).toBeNull();
    expect(observation.behavior).toBeNull();
    expect(observation.debuggerAttached).toBe(true);
    const result = await assess(observation);
    expect(result.status).toBe('AUTOMATION_SUSPECTED');
    expect(result.coverage.find(item => item.detector === 'webdriver')?.availability).toBe('unavailable');
  });
});

describe('icon-only toolbar states', () => {
  it('clears all text overlays while preserving qualified tooltips and icon colors', async () => {
    const setBadgeText = vi.fn();
    const setTitle = vi.fn();
    const setIcon = vi.fn();
    vi.stubGlobal('chrome', { action: { setBadgeText, setTitle, setIcon, setBadgeBackgroundColor: vi.fn() } });
    const adapter = await import('../src/background/browser');
    const labels = ['Agent active', 'Agent connected', 'Automation likely', 'Automation suspected', 'No automation observed', 'Unmonitored'];
    for (const [index, state] of CONTROL_STATES.entries()) {
      await adapter.updateBadge(7, state);
      expect(setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '' });
      const icon = index < 4 ? 'icon-alert' : 'icon';
      expect(setIcon).toHaveBeenLastCalledWith({ tabId: 7, path: { 16: `icons/${icon}-16.png`, 32: `icons/${icon}-32.png` } });
      expect(setTitle).toHaveBeenLastCalledWith({ tabId: 7, title: `AgentGuard · Last assessment: ${labels[index]} · Open for current evidence and limitations` });
    }
    expect(JSON.stringify(setTitle.mock.calls)).not.toMatch(/human|safe/i);
    await adapter.updateBadge(7, 'AGENT_ACTIVE', false, 'warn');
    expect(setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '' });
    await adapter.updateBadge(7, 'AGENT_CONNECTED', true, 'warn');
    expect(setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '' });
    expect(setTitle).toHaveBeenLastCalledWith({ tabId: 7, title: 'AgentGuard · Quarantine requested · Open to verify containment' });
  });

  it('restores neutral icons per tab after automation or policy warnings end', async () => {
    const setIcon = vi.fn();
    vi.stubGlobal('chrome', { action: { setIcon, setBadgeText: vi.fn(), setTitle: vi.fn(), setBadgeBackgroundColor: vi.fn() } });
    const adapter = await import('../src/background/browser');
    const alert = { 16: 'icons/icon-alert-16.png', 32: 'icons/icon-alert-32.png' };
    const neutral = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' };
    await adapter.updateBadge(7, 'AUTOMATION_SUSPECTED');
    await adapter.updateBadge(8, 'NO_AUTOMATION_OBSERVED');
    await adapter.updateBadge(7, 'UNMONITORED');
    await adapter.updateBadge(8, 'NO_AUTOMATION_OBSERVED', false, 'warn');
    await adapter.updateBadge(8, 'NO_AUTOMATION_OBSERVED');
    await adapter.updateBadge(7, 'UNMONITORED', true);
    await adapter.updateBadge(7, 'NO_AUTOMATION_OBSERVED');
    expect(setIcon.mock.calls).toEqual([
      [{ tabId: 7, path: alert }], [{ tabId: 8, path: neutral }], [{ tabId: 7, path: neutral }],
      [{ tabId: 8, path: alert }], [{ tabId: 8, path: neutral }], [{ tabId: 7, path: alert }], [{ tabId: 7, path: neutral }],
    ]);
  });
});
