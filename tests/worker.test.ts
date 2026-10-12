import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dashboard, Response } from '../src/shared/contracts';
import { DEFAULT_CONFIG } from '../src/enterprise/config';
import type { TabAlertPresentation, TabAlertStack } from '../src/content/tab-alert';

type Listener = (input: unknown, sender: chrome.runtime.MessageSender, respond: (result: unknown) => void) => boolean;

function chromeFixture(failStorage = false) {
  let listener: Listener | undefined;
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const event = () => ({ addListener: vi.fn((..._listeners: unknown[]) => undefined) });
  const area = (data: Record<string, unknown>) => ({
    get: vi.fn(async (key: string | null) => key === null ? data : { [key]: data[key] }),
    set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, value); }),
    setAccessLevel: vi.fn(async () => { if (failStorage) throw new Error('denied'); }),
  });
  const chromeMock = {
    storage: { local: area(local), session: area(session), managed: area({}), onChanged: event() },
    runtime: { id: 'ours', getURL: (path: string) => `chrome-extension://ours/${path}`,
      onMessage: { addListener: (value: Listener) => { listener = value; } },
      onInstalled: event(), onStartup: event() },
    tabs: { query: vi.fn(async (_query?: chrome.tabs.QueryInfo): Promise<Partial<chrome.tabs.Tab>[]> => []), get: vi.fn(async (id: number) => {
      const tab = (await chromeMock.tabs.query()).find(tab => tab.id === id);
      if (!tab) throw new Error('Missing tab');
      return tab;
    }), update: vi.fn(async (id: number, _properties: chrome.tabs.UpdateProperties) => ({ id, windowId: 1 })),
    onCreated: event(), onUpdated: event(), onActivated: event(), onRemoved: event(), onReplaced: event() },
    windows: { WINDOW_ID_NONE: -1, update: vi.fn(async (_id: number, _properties: chrome.windows.UpdateInfo) => undefined), onFocusChanged: event() },
    webNavigation: { getFrame: vi.fn(async (_details: { tabId: number; frameId: number }) => ({ documentId: 'doc-1', documentLifecycle: 'active', url: 'https://example.com' })),
      onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event() },
    debugger: { getTargets: vi.fn(async () => [{ id: 'target', type: 'page', tabId: 1, attached: false }]) },
    scripting: { executeScript: vi.fn(async (input: { files?: string[]; world: string; args?: unknown[]; func?: unknown; target?: unknown }) => input.files ? [] : [{ frameId: 0, documentId: 'doc-1',
      result: input.world === 'MAIN' ? { webdriver: true, fingerprints: [] } : null }]) },
    permissions: { getAll: vi.fn(async () => ({ permissions: [], origins: [] })), onAdded: event(), onRemoved: event() },
    alarms: { create: vi.fn(async () => undefined), onAlarm: event() },
    action: { setIcon: vi.fn(), setBadgeBackgroundColor: vi.fn(), setBadgeText: vi.fn(), setTitle: vi.fn() },
  };
  return {
    chromeMock, session, local,
    call(input: unknown, sender: chrome.runtime.MessageSender = { id: 'ours', url: 'chrome-extension://ours/options.html' }): Promise<unknown> {
      if (!listener) throw new Error('Worker listener was not registered');
      return new Promise((resolve) => listener!(input, sender, resolve));
    },
  };
}

const alertSender = { id: 'ours', url: 'https://example.com', frameId: 0, documentId: 'doc-1', documentLifecycle: 'active', tab: { id: 1 } } as chrome.runtime.MessageSender;
function alertPresentations(fixture: ReturnType<typeof chromeFixture>) {
  return fixture.chromeMock.scripting.executeScript.mock.calls.flatMap(([input]) =>
    typeof input.func === 'function' && input.func.name === 'renderTabAlert' ? [input.args![0] as TabAlertStack | null] : []);
}
async function issuedAlert(fixture: ReturnType<typeof chromeFixture>, tabId = 1): Promise<TabAlertPresentation> {
  const alerts = () => alertPresentations(fixture).flatMap(value => value?.alerts ?? []);
  await vi.waitFor(() => expect(alerts()).toContainEqual(expect.objectContaining({ tabId, state: 'AUTOMATION_LIKELY', token: expect.any(String) })));
  return alerts().find(value => value.tabId === tabId)!;
}

const recovery = { release: vi.fn(async () => undefined), reconcile: vi.fn(async () => undefined) };
beforeEach(() => {
  vi.resetModules();
  recovery.release.mockReset().mockResolvedValue(undefined);
  recovery.reconcile.mockReset().mockResolvedValue(undefined);
  vi.doMock('../src/background/containment', () => ({
    chromeContainmentPort: () => ({}),
    Containment: class { release = recovery.release; reconcile = recovery.reconcile; },
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock('../src/background/containment'); });

describe('service worker initialization and recovery', () => {
  it('observes existing tabs at startup without any popup command and dashboard reads do not start detection', async () => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    await vi.waitFor(() => expect(fixture.session['agentguard.session.v1']).toMatchObject({ tabs: { 1: { status: 'AUTOMATION_LIKELY', confidence: 0.82 } } }));
    await vi.waitFor(() => expect(fixture.session['agentguard.agent-sessions.v1']).toMatchObject({ sessions: [{ tabId: 1, controlState: 'AUTOMATION_LIKELY', controller: { displayName: null } }] }));
    await issuedAlert(fixture); // Startup includes presentation after session persistence; wait for that work before measuring reads.
    const count = fixture.chromeMock.scripting.executeScript.mock.calls.length;
    const debuggerCount = fixture.chromeMock.debugger.getTargets.mock.calls.length;
    expect(fixture.session['agentguard.debugger-history.v1']).toMatchObject({ coverageAvailable: true,
      targets: [{ targetId: 'target', tabId: 1, domain: 'example.com', owner: 'unknown', attached: false }] });
    expect(debuggerCount).toBe(1);
    await fixture.call({ type: 'GET_DASHBOARD' });
    await fixture.call({ type: 'GET_DASHBOARD' });
    expect(fixture.chromeMock.scripting.executeScript).toHaveBeenCalledTimes(count);
    expect(fixture.chromeMock.debugger.getTargets).toHaveBeenCalledTimes(debuggerCount);
    expect(fixture.chromeMock.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, world: 'ISOLATED', files: ['sensor.js'] });
    expect(await fixture.call({ type: 'SCAN_TAB', tabId: 1 })).toMatchObject({ ok: false });
  });

  it('keeps debugger history private and marks failed inspection unavailable without inventing detachment', async () => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com/PRIVATE_PATH?token=PRIVATE_TOKEN', status: 'complete' }]);
    fixture.chromeMock.debugger.getTargets.mockResolvedValue([{ id: 'target', type: 'page', tabId: 1, attached: true }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    await vi.waitFor(() => expect(fixture.session['agentguard.session.v1']).toMatchObject({ tabs: { 1: { status: 'AUTOMATION_LIKELY' } } }));
    const before = await fixture.call({ type: 'GET_DASHBOARD' }) as Response<Dashboard>;
    if (!before.ok) throw new Error(before.error);
    expect(before.data.debuggerIntelligence.targets[0]).toMatchObject({ currentAttached: true, owner: 'unknown', domain: 'example.com' });
    fixture.chromeMock.debugger.getTargets.mockRejectedValue(new Error('PRIVATE_POLICY_DETAIL'));
    const alarm = fixture.chromeMock.alarms.onAlarm.addListener.mock.calls[0]?.[0] as (value: { name: string }) => void;
    alarm({ name: 'agentguard.refresh.v1' });
    await vi.waitFor(async () => {
      const response = await fixture.call({ type: 'GET_DASHBOARD' }) as Response<Dashboard>;
      if (!response.ok) throw new Error(response.error);
      expect(response.data.debuggerIntelligence).toMatchObject({ coverageAvailable: false,
        targets: [{ currentAttached: null, attached: true, disappearedAt: null, lastSeen: before.data.debuggerIntelligence.targets[0]!.lastSeen }] });
      expect(response.data.tabs[0]).toMatchObject({ status: 'AUTOMATION_LIKELY', confidence: 0.82 });
      expect(response.data.debuggerIntelligence.targets[0]?.timeline.map(item => item.type)).not.toContain('detachment_observed');
      expect(JSON.stringify(response)).not.toMatch(/PRIVATE_PATH|PRIVATE_TOKEN|PRIVATE_POLICY_DETAIL/);
    });
    expect(JSON.stringify(fixture.session['agentguard.debugger-history.v1'])).not.toMatch(/PRIVATE|https:/);
    expect(fixture.local['agentguard.debugger-history.v1']).toBeUndefined();
  });

  it('does not collect debugger target history while monitoring is disabled', async () => {
    const fixture = chromeFixture();
    fixture.local['agentguard.config.v1'] = { ...DEFAULT_CONFIG, monitoringEnabled: false };
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    await vi.waitFor(() => expect(fixture.session['agentguard.session.v1']).toMatchObject({ tabs: { 1: { status: 'UNMONITORED' } } }));
    expect(fixture.session['agentguard.debugger-history.v1']).toMatchObject({ coverageAvailable: false, targets: [] });
    await vi.waitFor(() => expect(alertPresentations(fixture).at(-1)).toMatchObject({ alerts: [] }));
    expect(fixture.chromeMock.scripting.executeScript.mock.calls.some(([input]) => input.world === 'MAIN')).toBe(false);
  });

  it('continues tab detection when debugger history cannot be saved', async () => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    fixture.chromeMock.storage.session.set.mockImplementation(async value => {
      if ('agentguard.debugger-history.v1' in value) throw new Error('PRIVATE_STORAGE_DETAIL');
      Object.assign(fixture.session, value);
    });
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    await vi.waitFor(() => expect(fixture.session['agentguard.session.v1']).toMatchObject({ tabs: { 1: { status: 'AUTOMATION_LIKELY' } } }));
    const response = await fixture.call({ type: 'GET_DASHBOARD' }) as Response<Dashboard>;
    if (!response.ok) throw new Error(response.error);
    expect(response.data.healthErrors).toContain('Debugger observation history could not be saved. Detection coverage is reported independently.');
    expect(response.data.debuggerIntelligence.targets[0]).toMatchObject({ currentAttached: false, owner: 'unknown' });
    expect(JSON.stringify(response)).not.toContain('PRIVATE_STORAGE_DETAIL');
  });

  it('ends closed-tab sessions, exports sanitized history, and clears history without clearing live sessions', async () => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com/PRIVATE_PATH?token=PRIVATE_TOKEN', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    await vi.waitFor(() => expect(fixture.session['agentguard.agent-sessions.v1']).toMatchObject({ sessions: [{ tabId: 1 }] }));
    expect(await fixture.call({ type: 'CLEAR_SESSION_HISTORY' })).toEqual({ ok: true, data: null });
    expect(await fixture.call({ type: 'GET_DASHBOARD' })).toMatchObject({ ok: true, data: { sessions: [{ tabId: 1, domain: 'example.com' }] } });
    fixture.chromeMock.tabs.query.mockResolvedValue([]);
    fixture.chromeMock.debugger.getTargets.mockResolvedValue([]);
    const removed = fixture.chromeMock.tabs.onRemoved.addListener.mock.calls[0]?.[0] as unknown as (tabId: number) => void;
    removed(1);
    await vi.waitFor(() => expect(fixture.local['agentguard.agent-history.v1']).toMatchObject({ sessions: [{ tabId: 1, endReason: 'closed', active: false }] }));
    await vi.waitFor(() => expect(fixture.session['agentguard.debugger-history.v1']).toMatchObject({
      targets: [{ tabId: 1, disappearedAt: expect.any(Number), timeline: expect.arrayContaining([{ type: 'target_disappeared', timestamp: expect.any(Number) }]) }],
    }));
    const exported = await fixture.call({ type: 'EXPORT_SESSIONS' });
    expect(exported).toMatchObject({ ok: true, data: { schemaVersion: 1, source: 'agentguard-extension', sessions: [], history: [{ domain: 'example.com', endReason: 'closed' }] } });
    expect(JSON.stringify(exported)).not.toMatch(/PRIVATE_PATH|PRIVATE_TOKEN|https:\/\//);
    expect(await fixture.call({ type: 'GET_SESSION_HISTORY' })).toMatchObject({ ok: true, data: [{ tabId: 1 }] });
    await fixture.call({ type: 'CLEAR_SESSION_HISTORY' });
    expect(await fixture.call({ type: 'GET_SESSION_HISTORY' })).toEqual({ ok: true, data: [] });
  });

  it('hides prior automation sessions when navigation has invalidated current evidence', async () => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    await vi.waitFor(() => expect(fixture.session['agentguard.agent-sessions.v1']).toMatchObject({ sessions: [{ tabId: 1 }] }));
    const updated = fixture.chromeMock.tabs.onUpdated.addListener.mock.calls[0]?.[0] as unknown as (id: number, change: { status: string }) => void;
    updated(1, { status: 'loading' });
    expect(await fixture.call({ type: 'GET_DASHBOARD' })).toMatchObject({ ok: true, data: { sessions: [] } });
    // Previous observations remain bounded history candidates, never a current safety claim.
    expect(fixture.session['agentguard.agent-sessions.v1']).toMatchObject({ sessions: [{ tabId: 1 }] });
  });

  it('rejects a stale-document sensor signal before scheduling observation', async () => {
    const fixture = chromeFixture();
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const response = await fixture.call({ type: 'SENSOR_SIGNAL', schemaVersion: 1, sequence: 1, reason: 'ready', observedAt: Date.now(),
      visibility: 'visible', counts: { pointer: 0, keyboard: 0, input: 0, submit: 0, scroll: 0, focus: 0, trusted: 0, synthetic: 0, hiddenTrusted: 0 }, lastActivityAt: null },
    { id: 'ours', url: 'https://example.com', frameId: 0, documentId: 'old-document', documentLifecycle: 'active', tab: { id: 1 } as chrome.tabs.Tab });
    expect(response).toEqual({ ok: false });
    expect(fixture.chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('keeps dashboard and recovery commands working after reconciliation failure', async () => {
    const fixture = chromeFixture();
    recovery.reconcile.mockRejectedValue(new Error('native rule failure with PRIVATE_URL'));
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const response = await fixture.call({ type: 'GET_DASHBOARD' }) as Response<Dashboard>;
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    expect(response.data.healthErrors).toContain('Some quarantine rules could not be restored. Review or release affected tabs; monitoring remains available.');
    expect(JSON.stringify(response)).not.toContain('PRIVATE_URL');
    expect(await fixture.call({ type: 'RELEASE_TAB', tabId: 1 })).toEqual({ ok: true, data: null });
    expect(recovery.release).toHaveBeenCalledWith(1);
    for (const area of [fixture.chromeMock.storage.local, fixture.chromeMock.storage.session, fixture.chromeMock.storage.managed]) {
      expect(area.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  });
  it('shows initialization failures in the dashboard while rejecting mutations', async () => {
    const fixture = chromeFixture(true);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const response = await fixture.call({ type: 'GET_DASHBOARD' }) as Response<Dashboard>;
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    expect(response.data.healthErrors.some((message) => message.includes('could not initialize'))).toBe(true);
    expect(await fixture.call({ type: 'RELEASE_TAB', tabId: 1 })).toMatchObject({ ok: false });
    expect(recovery.release).not.toHaveBeenCalled();
  });
  it('rejects forged renderer commands before any privileged operation', async () => {
    const fixture = chromeFixture();
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    expect(await fixture.call({ type: 'RELEASE_TAB', tabId: 1 }, { id: 'ours', url: 'https://example.com' })).toMatchObject({ ok: false });
    expect(await fixture.call({ type: 'RELEASE_TAB', tabId: -1 })).toMatchObject({ ok: false });
    for (const type of ['GET_SESSION_HISTORY', 'EXPORT_SESSIONS', 'CLEAR_SESSION_HISTORY']) {
      expect(await fixture.call({ type }, { id: 'ours', url: 'https://example.com' })).toMatchObject({ ok: false });
      expect(await fixture.call({ type, tabId: 1 })).toMatchObject({ ok: false });
    }
    expect(recovery.release).not.toHaveBeenCalled();
  });
});

describe('service worker tab-alert activation boundary', () => {
  it('activates the existing tab, acknowledges only a saved tab-specific mute, continues detection, and cleans up on close', async () => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const presentation = await issuedAlert(fixture);
    expect(fixture.chromeMock.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 1, documentIds: ['doc-1'] }, world: 'ISOLATED', args: [{ revision: expect.any(Number), alerts: [presentation] }],
    }));
    const before = Date.now();
    const response = await fixture.call({ type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: presentation.token }, alertSender) as { ok: boolean; mutedUntil: number };
    expect(response.ok).toBe(true);
    expect(response.mutedUntil).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(response.mutedUntil).toBeLessThanOrEqual(Date.now() + 86_400_000);
    expect(fixture.session['agentguard.alert-mutes.v1']).toEqual({ schemaVersion: 1, entries: [{ tabId: 1, mutedUntil: response.mutedUntil }] });
    expect(JSON.stringify(fixture.session['agentguard.alert-mutes.v1'])).not.toContain(presentation.token);
    expect(fixture.local['agentguard.alert-mutes.v1']).toBeUndefined();
    expect(fixture.chromeMock.tabs.update).toHaveBeenCalledExactlyOnceWith(1, { active: true });
    expect(fixture.chromeMock.windows.update).toHaveBeenCalledExactlyOnceWith(1, { focused: true });
    expect(await fixture.call({ type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: presentation.token }, alertSender)).toEqual({ ok: false });

    const observations = fixture.chromeMock.scripting.executeScript.mock.calls.filter(([input]) => input.world === 'MAIN').length;
    const alarm = fixture.chromeMock.alarms.onAlarm.addListener.mock.calls[0]?.[0] as (value: { name: string }) => void;
    alarm({ name: 'agentguard.refresh.v1' });
    await vi.waitFor(() => expect(alertPresentations(fixture).at(-1)).toMatchObject({ alerts: [] }));
    await vi.waitFor(() => expect(fixture.chromeMock.scripting.executeScript.mock.calls.filter(([input]) => input.world === 'MAIN')).toHaveLength(observations + 1));
    expect(fixture.session['agentguard.session.v1']).toMatchObject({ tabs: { 1: { status: 'AUTOMATION_LIKELY', confidence: 0.82 } } });
    expect(fixture.session['agentguard.agent-sessions.v1']).toMatchObject({ sessions: [{ tabId: 1, controlState: 'AUTOMATION_LIKELY' }] });
    expect(fixture.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 1, text: '' });
    expect(fixture.chromeMock.action.setIcon).toHaveBeenLastCalledWith({ tabId: 1, path: { 16: 'icons/icon-alert-16.png', 32: 'icons/icon-alert-32.png' } });

    fixture.chromeMock.tabs.query.mockResolvedValue([]);
    fixture.chromeMock.debugger.getTargets.mockResolvedValue([]);
    const removed = fixture.chromeMock.tabs.onRemoved.addListener.mock.calls[0]?.[0] as (tabId: number) => void;
    removed(1);
    await vi.waitFor(() => expect(fixture.session['agentguard.alert-mutes.v1']).toEqual({ schemaVersion: 1, entries: [] }));
    await vi.waitFor(() => expect((fixture.session['agentguard.session.v1'] as { tabs: Record<string, unknown> }).tabs).not.toHaveProperty('1'));
    await vi.waitFor(() => expect(fixture.session['agentguard.debugger-history.v1']).toMatchObject({ targets: [{ disappearedAt: expect.any(Number) }] }));
  });

  it('rejects forged, non-top-frame, non-current and extra-field requests without writing a mute', async () => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const presentation = await issuedAlert(fixture);
    const message = { type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: presentation.token };
    for (const patch of [{ id: 'other' }, { frameId: 1 }, { documentId: 'previous-document' }, { documentId: undefined },
      { documentLifecycle: 'prerender' }, { tab: { id: 2 } }, { url: 'chrome://settings' }]) {
      expect(await fixture.call(message, { ...alertSender, ...patch } as chrome.runtime.MessageSender)).toEqual({ ok: false });
    }
    for (const patch of [{ token: 'not-issued' }, { schemaVersion: 2 }, { tabId: 1 }, { password: 'PRIVATE' }]) {
      expect(await fixture.call({ ...message, ...patch }, alertSender)).toEqual({ ok: false });
    }
    expect(await fixture.call(message)).toEqual({ ok: false });
    fixture.chromeMock.webNavigation.getFrame.mockResolvedValue({ documentId: 'new-document', documentLifecycle: 'active', url: 'https://example.com' });
    expect(await fixture.call(message, alertSender)).toEqual({ ok: false });
    expect(fixture.session['agentguard.alert-mutes.v1']).toBeUndefined();
    expect(fixture.chromeMock.storage.session.set.mock.calls.some(([data]) => 'agentguard.alert-mutes.v1' in data)).toBe(false);
    expect(fixture.chromeMock.tabs.update).not.toHaveBeenCalled();
    expect(fixture.chromeMock.windows.update).not.toHaveBeenCalled();
  });

  it('rejects a validly issued token after its observation expires', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const presentation = await issuedAlert(fixture);
    clock.mockReturnValue(presentation.expiresAt);
    expect(await fixture.call({ type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: presentation.token }, alertSender)).toEqual({ ok: false });
    expect(fixture.session['agentguard.alert-mutes.v1']).toBeUndefined();
    expect(fixture.chromeMock.tabs.update).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it('does not acknowledge failed storage writes and permits an honest retry after recovery', async () => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const presentation = await issuedAlert(fixture);
    fixture.chromeMock.storage.session.set.mockImplementation(async value => {
      if ('agentguard.alert-mutes.v1' in value) throw new Error('PRIVATE_STORAGE_ERROR');
      Object.assign(fixture.session, value);
    });
    const request = { type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: presentation.token };
    expect(await fixture.call(request, alertSender)).toEqual({ ok: false });
    expect(fixture.session['agentguard.alert-mutes.v1']).toBeUndefined();
    expect(await fixture.call({ type: 'GET_DASHBOARD' })).toMatchObject({ ok: true, data: { tabs: [{ tabId: 1, status: 'AUTOMATION_LIKELY' }] } });
    fixture.chromeMock.storage.session.set.mockImplementation(async value => { Object.assign(fixture.session, value); });
    expect(await fixture.call(request, alertSender)).toEqual({ ok: true, mutedUntil: expect.any(Number) });
    expect(fixture.session['agentguard.alert-mutes.v1']).toMatchObject({ schemaVersion: 1, entries: [{ tabId: 1 }] });
  });

  it('routes a host notification to its issued target tab and mutes only that target across the stack', async () => {
    const fixture = chromeFixture();
    const tabs: Partial<chrome.tabs.Tab>[] = [
      { id: 1, windowId: 7, active: true, url: 'https://example.com', status: 'complete' },
      { id: 2, windowId: 7, active: false, url: 'https://accounts.example.com/PRIVATE_PATH?token=PRIVATE_TOKEN', status: 'complete' },
    ];
    fixture.chromeMock.tabs.query.mockImplementation(async query => query?.active ? tabs.filter(tab => tab.active) : tabs);
    const documents = new Map([[1, 'doc-1'], [2, 'doc-2']]);
    fixture.chromeMock.webNavigation.getFrame.mockImplementation(async ({ tabId }) => ({
      documentId: documents.get(tabId)!, documentLifecycle: 'active', url: tabs.find(tab => tab.id === tabId)!.url!,
    }));
    fixture.chromeMock.tabs.update.mockImplementation(async (tabId, properties) => {
      expect(properties).toEqual({ active: true });
      for (const tab of tabs) tab.active = tab.id === tabId;
      return { id: tabId, windowId: 7 };
    });
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const target = await issuedAlert(fixture, 2);
    const stack = alertPresentations(fixture).find(value => value?.alerts.length === 2)!;
    expect(stack.alerts.map(alert => ({ tabId: alert.tabId, domain: alert.domain }))).toEqual([
      { tabId: 1, domain: 'example.com' }, { tabId: 2, domain: 'accounts.example.com' },
    ]);
    expect(JSON.stringify(stack)).not.toMatch(/PRIVATE_PATH|PRIVATE_TOKEN|https:/);
    expect(fixture.chromeMock.tabs.query).toHaveBeenCalledWith({ active: true });
    expect(fixture.chromeMock.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 1, documentIds: ['doc-1'] }, args: [stack],
    }));

    const request = { type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: target.token };
    expect(await fixture.call({ ...request, tabId: 1 }, alertSender)).toEqual({ ok: false });
    expect(await fixture.call(request, { ...alertSender, tab: { id: 2 }, documentId: 'doc-2' } as chrome.runtime.MessageSender)).toEqual({ ok: false });
    documents.set(2, 'navigated-target-document');
    expect(await fixture.call(request, alertSender)).toEqual({ ok: false });
    expect(fixture.chromeMock.tabs.update).not.toHaveBeenCalled();
    expect(fixture.session['agentguard.alert-mutes.v1']).toBeUndefined();
    documents.set(2, 'doc-2');

    const before = Date.now();
    const response = await fixture.call(request, alertSender) as { ok: boolean; mutedUntil: number };
    expect(response.ok).toBe(true);
    expect(response.mutedUntil).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(response.mutedUntil).toBeLessThanOrEqual(Date.now() + 86_400_000);
    expect(fixture.chromeMock.tabs.update).toHaveBeenCalledExactlyOnceWith(2, { active: true });
    expect(fixture.chromeMock.windows.update).toHaveBeenCalledExactlyOnceWith(7, { focused: true });
    expect(fixture.session['agentguard.alert-mutes.v1']).toEqual({ schemaVersion: 1, entries: [{ tabId: 2, mutedUntil: response.mutedUntil }] });
    expect(JSON.stringify(fixture.session['agentguard.alert-mutes.v1'])).not.toContain(target.token);
    await vi.waitFor(() => expect(fixture.chromeMock.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 2, documentIds: ['doc-2'] }, args: [{ revision: expect.any(Number), alerts: [expect.objectContaining({ tabId: 1 })] }],
    })));
    expect(await fixture.call({ type: 'GET_DASHBOARD' })).toMatchObject({ ok: true, data: { tabs: [
      { tabId: 1, status: 'AUTOMATION_LIKELY' }, { tabId: 2, status: 'AUTOMATION_LIKELY' },
    ] } });
    expect(await fixture.call(request, alertSender)).toEqual({ ok: false });
    expect(await fixture.call({ ...request, type: 'DISMISS_TAB_ALERT' }, alertSender)).toMatchObject({ ok: false });
  });

  it.each(['tab', 'window'] as const)('does not mute or acknowledge a failed %s activation and allows retry', async failure => {
    const fixture = chromeFixture();
    fixture.chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', status: 'complete' }]);
    vi.stubGlobal('chrome', fixture.chromeMock);
    await import('../src/background/worker');
    const presentation = await issuedAlert(fixture);
    if (failure === 'tab') fixture.chromeMock.tabs.update.mockRejectedValueOnce(new Error('PRIVATE_TAB_ERROR'));
    else fixture.chromeMock.windows.update.mockRejectedValueOnce(new Error('PRIVATE_WINDOW_ERROR'));
    const request = { type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: presentation.token };
    expect(await fixture.call(request, alertSender)).toEqual({ ok: false });
    expect(fixture.session['agentguard.alert-mutes.v1']).toBeUndefined();
    expect(fixture.chromeMock.storage.session.set.mock.calls.some(([data]) => 'agentguard.alert-mutes.v1' in data)).toBe(false);
    if (failure === 'tab') expect(fixture.chromeMock.windows.update).not.toHaveBeenCalled();
    expect(await fixture.call(request, alertSender)).toEqual({ ok: true, mutedUntil: expect.any(Number) });
    expect(fixture.session['agentguard.alert-mutes.v1']).toMatchObject({ schemaVersion: 1, entries: [{ tabId: 1 }] });
  });
});
