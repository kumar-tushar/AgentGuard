import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dashboard, Response } from '../src/shared/contracts';

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
    tabs: { query: vi.fn(async (): Promise<Partial<chrome.tabs.Tab>[]> => []), get: vi.fn(async (id: number) => {
      const tab = (await chromeMock.tabs.query()).find(tab => tab.id === id);
      if (!tab) throw new Error('Missing tab');
      return tab;
    }), onCreated: event(), onUpdated: event(), onActivated: event(), onRemoved: event(), onReplaced: event() },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event() },
    webNavigation: { getFrame: vi.fn(async () => ({ documentId: 'doc-1', documentLifecycle: 'active' })),
      onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event() },
    debugger: { getTargets: vi.fn(async () => [{ id: 'target', type: 'page', tabId: 1, attached: false }]) },
    scripting: { executeScript: vi.fn(async (input: { files?: string[]; world: string }) => input.files ? [] : [{ frameId: 0, documentId: 'doc-1',
      result: input.world === 'MAIN' ? { webdriver: true, fingerprints: [] } : null }]) },
    permissions: { getAll: vi.fn(async () => ({ permissions: [], origins: [] })), onAdded: event(), onRemoved: event() },
    alarms: { create: vi.fn(async () => undefined), onAlarm: event() },
    action: { setBadgeBackgroundColor: vi.fn(), setBadgeText: vi.fn(), setTitle: vi.fn() },
  };
  return {
    chromeMock, session, local,
    call(input: unknown, sender: chrome.runtime.MessageSender = { id: 'ours', url: 'chrome-extension://ours/options.html' }): Promise<unknown> {
      if (!listener) throw new Error('Worker listener was not registered');
      return new Promise((resolve) => listener!(input, sender, resolve));
    },
  };
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
    const count = fixture.chromeMock.scripting.executeScript.mock.calls.length;
    const debuggerCount = fixture.chromeMock.debugger.getTargets.mock.calls.length;
    await fixture.call({ type: 'GET_DASHBOARD' });
    await fixture.call({ type: 'GET_DASHBOARD' });
    expect(fixture.chromeMock.scripting.executeScript).toHaveBeenCalledTimes(count);
    expect(fixture.chromeMock.debugger.getTargets).toHaveBeenCalledTimes(debuggerCount);
    expect(fixture.chromeMock.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, world: 'ISOLATED', files: ['sensor.js'] });
    expect(await fixture.call({ type: 'SCAN_TAB', tabId: 1 })).toMatchObject({ ok: false });
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
    const removed = fixture.chromeMock.tabs.onRemoved.addListener.mock.calls[0]?.[0] as unknown as (tabId: number) => void;
    removed(1);
    await vi.waitFor(() => expect(fixture.local['agentguard.agent-history.v1']).toMatchObject({ sessions: [{ tabId: 1, endReason: 'closed', active: false }] }));
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
