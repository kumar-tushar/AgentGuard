// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentGuardConfig, Dashboard, TabAgentStatus, TabState } from '../src/shared/contracts';
import { emptyActivity, unknownIdentity, type AgentSession } from '../src/shared/intelligence';
import { TabAssessment } from '../src/ui/components';
import { Popup } from '../src/ui/popup';
import { Options } from '../src/ui/options';
import { Blocked } from '../src/ui/blocked';
import { DebuggerHistory } from '../src/ui/debugger-history';
import type { DebuggerIntelligenceView } from '../src/shared/intelligence';
import { TrafficControls } from '../src/ui/traffic';
import { Integrations } from '../src/ui/integrations';
import { EmergencyControls } from '../src/ui/emergency';

const config: AgentGuardConfig = {
  schemaVersion: 1,
  monitoringEnabled: true,
  behaviorEnabled: true,
  policyMode: 'warn',
  sensitiveDomains: ['example.com'],
  minimumConfidence: 0.65,
  retentionDays: 30,
  maxAuditEvents: 500,
  sessionRetentionDays: 7,
  maxHistorySessions: 50,
};

function assessment(status: TabState = 'AUTOMATION_SUSPECTED'): TabAgentStatus {
  const now = Date.now();
  return {
    tabId: 7,
    domain: 'example.com',
    status,
    identifiedAgent: null,
    frameworkHints: ['Playwright'],
    confidence: 0.62,
    evidence: [{ detector: 'webdriver', family: 'runtime', confidence: 0.62, description: 'WebDriver flag observed', metadata: {}, observedAt: now, expiresAt: now + 90_000 }],
    coverage: [{ detector: 'webdriver', availability: 'available', reason: 'Runtime probe completed' }, { detector: 'debugger', availability: 'unavailable', reason: 'Reduced coverage: debugger access restricted by Chrome or organization policy' }],
    firstDetectedAt: now,
    lastDetectedAt: now,
    assessedAt: now,
    expiresAt: now + 90_000,
    policy: { action: 'warn', reason: 'Sensitive domain and threshold matched', matchedDomain: 'example.com' },
  };
}

function dashboard(status: TabState = 'AUTOMATION_SUSPECTED'): Dashboard {
  return {
    config: { values: config, managedKeys: ['policyMode'], errors: [] },
    capabilities: { debugger: false, networkBlocking: false, origins: [] },
    tabs: [assessment(status)],
    audit: [],
    quarantines: [],
    healthErrors: [],
    sessions: [],
    debuggerIntelligence: { coverageAvailable: false, lastCapturedAt: null, targets: [] },
  };
}

function session(ended = false): AgentSession {
  const now = Date.now();
  return {
    id: ended ? 'ended-session' : 'current-session', tabId: ended ? 8 : 7,
    domain: ended ? 'history.example.org' : 'example.com', controlState: 'AUTOMATION_SUSPECTED',
    controller: unknownIdentity(), automationStack: { transports: ['CDP'], frameworks: ['Playwright-like'], environmentHints: [], controllerCandidates: [] },
    controlScore: 0.62, frameworkConfidence: 0.5, coverageScore: 0.75,
    startedAt: now - 60_000, lastActivityAt: now - 10_000, lastObservedAt: now, expiresAt: now + 90_000,
    endedAt: ended ? now : null, endReason: ended ? 'closed' : null, active: !ended,
    evidenceIds: ['webdriver:webdriver'], observedActivity: { ...emptyActivity(), navigations: 2, keyboardInteractions: 3 },
    timeline: [
      { id: 'timeline-1', timestamp: now - 60_000, kind: 'INFERRED', type: 'session_started', description: 'Automation observation session started' },
      { id: 'timeline-2', timestamp: now - 10_000, kind: 'OBSERVED', type: 'navigation_observed', description: 'Navigation observed during automation session' },
    ],
  };
}

function mockChrome(currentDashboard = dashboard(), sessionHistory: AgentSession[] = []) {
  const sendMessage = vi.fn(async (request: { type: string }) => {
    if (request.type === 'GET_DASHBOARD') return { ok: true, data: structuredClone(currentDashboard) };
    if (request.type === 'GET_SESSION_HISTORY') return { ok: true, data: structuredClone(sessionHistory) };
    if (request.type === 'EXPORT_SESSIONS') return { ok: true, data: { schemaVersion: 1, exportedAt: Date.now(), source: 'agentguard-extension', sessions: structuredClone(currentDashboard.sessions), history: structuredClone(sessionHistory) } };
    if (request.type === 'CLEAR_SESSION_HISTORY') { sessionHistory = []; return { ok: true, data: null }; }
    if (request.type === 'RELEASE_TAB') return { ok: true, data: { navigation: 'requested' } };
    if (request.type === 'CLOSE_TAB' || request.type === 'CLEAR_AUDIT') return { ok: true, data: null };
    if (request.type === 'SAVE_CONFIG') return { ok: true, data: currentDashboard.config };
    if (request.type === 'EXPORT_AUDIT') return { ok: true, data: { schemaVersion: 1, exportedAt: Date.now(), source: 'agentguard-extension', events: [] } };
    if (request.type === 'QUARANTINE_TAB') return { ok: true, data: { tabId: 7, domain: 'example.com', createdAt: Date.now(), reason: 'Manual', networkBlocked: false } };
    return { ok: false, error: 'Unexpected request' };
  });
  const request = vi.fn(async () => true);
  const getAll = vi.fn(async (): Promise<chrome.permissions.Permissions> => ({ origins: [], permissions: [] }));
  vi.stubGlobal('chrome', {
    runtime: { id: 'agentguard-test', sendMessage, openOptionsPage: vi.fn(), getURL: (path: string) => `chrome-extension://agentguard-test/${path}`, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { query: vi.fn(async () => [{ id: 7 }]), getCurrent: vi.fn(async () => ({ id: 7 })), create: vi.fn(async () => ({ id: 8 })) },
    permissions: { getAll, request, remove: vi.fn(async () => true) },
  });
  return { sendMessage, request, getAll };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('optional parity controls', () => {
  it('does not request permissions or contact services just by opening their UI', () => {
    const mock = mockChrome(); const current = dashboard();
    render(<><TrafficControls dashboard={current} tabs={current.tabs} onChanged={() => undefined} /><Integrations dashboard={current} tabs={current.tabs} onChanged={() => undefined} /></>);
    expect(mock.request).not.toHaveBeenCalled(); expect(mock.sendMessage).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Look up framework types' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send aggregate contribution once' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('requires explicit confirmation before enabling browser-wide download cancellation', async () => {
    const mock = mockChrome(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false), current = dashboard();
    render(<TrafficControls dashboard={current} tabs={current.tabs} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Block ALL browser downloads' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(mock.request).not.toHaveBeenCalled(); expect(mock.sendMessage).not.toHaveBeenCalled();
  });
  it('requests notification permission from the click before saving settings and respects managed locks', async () => {
    const mock = mockChrome(); const current = dashboard();
    const view = render(<TrafficControls dashboard={current} tabs={current.tabs} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable desktop alerts' }));
    await waitFor(() => expect(mock.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SAVE_CONFIG', config: expect.objectContaining({ desktopNotifications: true }) })));
    expect(mock.request).toHaveBeenCalledWith({ permissions: ['notifications'] });
    expect(mock.request.mock.invocationCallOrder[0]).toBeLessThan(mock.sendMessage.mock.invocationCallOrder[0]!);
    view.rerender(<TrafficControls dashboard={{ ...current, config: { ...current.config, managedKeys: ['desktopNotifications'] } }} tabs={current.tabs} onChanged={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Enable desktop alerts' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows incomplete emergency revocation and unconfirmed outcomes without claiming a successful stop', () => {
    mockChrome(); render(<EmergencyControls state={{ schemaVersion: 1, active: true, activatedAt: Date.now(), grantsRevoked: false, outcomes: [{ tabId: 7, domain: 'example.com', action: 'quarantine', result: 'failed', timestamp: Date.now() }] }} onChanged={() => undefined} />);
    expect(screen.getByText(/Delegation cleanup was not confirmed/)).toBeTruthy();
    expect(screen.getByText(/quarantine: not confirmed/)).toBeTruthy();
  });
});

describe('user assessment', () => {
  it('puts the current-tab answer and controls before supporting detail and browser-wide totals', async () => {
    mockChrome(); render(<Popup />);
    await screen.findByRole('heading', { name: 'Automation suspected' });
    const current = screen.getByRole('region', { name: 'Current tab assessment' });
    const controls = screen.getByRole('region', { name: 'Tab controls' });
    const evidence = screen.getByRole('heading', { name: 'Supporting evidence' });
    const browser = screen.getByRole('region', { name: 'Browser-wide summary' });
    expect(current.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controls.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(evidence.compareDocumentPosition(browser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const settings = screen.getByRole('button', { name: /^Settings$/ });
    expect(settings.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
  it.each([
    ['NO_AUTOMATION_OBSERVED', 'No automation observed'],
    ['AGENT_ACTIVE', 'Automation active'],
    ['AGENT_CONNECTED', 'Automation connected'],
    ['AUTOMATION_LIKELY', 'Automation likely'],
    ['AUTOMATION_SUSPECTED', 'Automation suspected'],
    ['UNMONITORED', 'Unmonitored'],
  ] as const)('qualifies %s as %s without asserting agent identity', (state, label) => {
    render(<TabAssessment assessment={assessment(state)} />);
    expect(screen.getByRole('heading', { name: label })).toBeTruthy();
    expect(screen.getByText('Not identified')).toBeTruthy();
    expect(screen.getByText(/not a probability of AI control/i)).toBeTruthy();
    expect(screen.getByText(/Unverified framework hints/)).toBeTruthy();
  });

  it('reads the stored active-tab assessment and shows coverage gaps without starting detection', async () => {
    const { sendMessage } = mockChrome();
    render(<Popup />);
    await screen.findByRole('heading', { name: 'Automation suspected' });
    expect(sendMessage.mock.calls.map(([request]) => request)).toEqual([{ type: 'GET_DASHBOARD' }]);
    expect(screen.queryByRole('button', { name: /scan/i })).toBeNull();
    expect(screen.getByText('Reduced coverage: debugger access restricted by Chrome or organization policy')).toBeTruthy();
    expect(screen.getByText(/This does not stop external automation|not the external controller/i)).toBeTruthy();
    expect(document.querySelector('.brand-mark')?.getAttribute('src')).toBe('./icons/icon-alert-128.png');
    expect(document.querySelector('.brand-mark')?.getAttribute('alt')).toBe('');
  });

  it('never presents a cached score as current when the monitoring data request fails', async () => {
    const { sendMessage } = mockChrome();
    sendMessage.mockResolvedValue({ ok: false, error: 'Monitoring data unavailable' });
    render(<Popup />);
    await screen.findByText('Monitoring data unavailable');
    expect(screen.getByText(/Current control is unknown/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Automation suspected' })).toBeNull();
  });

  it('expires an open popup and only shows new evidence after automatic monitoring updates stored data', async () => {
    vi.useFakeTimers();
    const current = dashboard();
    const { sendMessage } = mockChrome(current);
    await act(async () => { render(<Popup />); });
    expect(screen.getByRole('heading', { name: 'Automation suspected' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(89_999); });
    expect(screen.getByRole('heading', { name: 'Automation suspected' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('heading', { name: 'Unmonitored' })).toBeTruthy();
    expect(document.querySelector('.brand-mark')?.getAttribute('src')).toBe('./icons/icon-128.png');
    expect(screen.queryByText('WebDriver flag observed')).toBeNull();
    expect(screen.queryByText(/Unverified framework hints/)).toBeNull();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
    expect(sendMessage.mock.calls.every(([request]) => request.type === 'GET_DASHBOARD')).toBe(true);
    current.tabs = [assessment()];
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByRole('heading', { name: 'Automation suspected' })).toBeTruthy();
  });

  it('shows browser-wide stored assessments without mixing another tab into current-tab details', async () => {
    const current = dashboard();
    current.tabs.push({ ...assessment('AUTOMATION_LIKELY'), tabId: 8, domain: 'other.example.org' });
    mockChrome(current);
    render(<Popup />);
    await screen.findByRole('heading', { name: 'Automation suspected' });
    const summary = screen.getByRole('region', { name: 'Browser-wide summary' });
    expect(within(summary).getByText('2 tab assessments')).toBeTruthy();
    expect(within(summary).getByText('other.example.org')).toBeTruthy();
    expect(within(summary).getByText('Automation likely')).toBeTruthy();
    expect(within(summary).getByText('Tab 7 · Current tab')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Automation likely' })).toBeNull();
  });

  it('reports unmonitored for a missing active-tab assessment without triggering detection', async () => {
    const current = dashboard();
    current.tabs = [];
    const { sendMessage } = mockChrome(current);
    render(<Popup />);
    await screen.findByText('No stored tab assessments yet.');
    expect(screen.getByRole('heading', { name: 'Unmonitored' })).toBeTruthy();
    expect(screen.getByText(/This does not mean the tab is safe/)).toBeTruthy();
    expect(document.querySelector('.brand-mark')?.getAttribute('src')).toBe('./icons/icon-128.png');
    expect(sendMessage.mock.calls.map(([request]) => request)).toEqual([{ type: 'GET_DASHBOARD' }]);
  });

  it('expires activity context without misreporting the runtime/debugger assessment as expired', async () => {
    vi.useFakeTimers();
    const current = assessment('NO_AUTOMATION_OBSERVED');
    current.evidence[0] = { detector: 'behavior', family: 'behavior', confidence: 0.5, description: 'Recent trusted activity observed', metadata: { signal: 'trusted-activity' }, observedAt: Date.now(), expiresAt: Date.now() + 30_000 };
    render(<TabAssessment assessment={current} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole('heading', { name: 'No automation observed' })).toBeTruthy();
    expect(screen.queryByText('Recent trusted activity observed')).toBeNull();
    expect(screen.queryByText(/Assessment expired/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole('heading', { name: 'Unmonitored' })).toBeTruthy();
  });

  it('removes the previous document assessment after manual quarantine', async () => {
    const { sendMessage } = mockChrome();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Popup />);
    await screen.findByRole('heading', { name: 'Automation suspected' });
    fireEvent.click(screen.getByRole('button', { name: 'Quarantine tab' }));
    await screen.findByText('Tab quarantined. This does not stop external automation.');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'QUARANTINE_TAB', tabId: 7 });
    expect(screen.queryByRole('heading', { name: 'Automation suspected' })).toBeNull();
  });

  it('requires explicit confirmation before closing a tab', async () => {
    const { sendMessage } = mockChrome();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Popup />);
    await screen.findByRole('heading', { name: 'Automation suspected' });
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith({ type: 'CLOSE_TAB', tabId: 7 });
  });

  it('requires explicit confirmation before quarantining a tab', async () => {
    const { sendMessage } = mockChrome();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Popup />);
    await screen.findByRole('heading', { name: 'Automation suspected' });
    fireEvent.click(screen.getByRole('button', { name: 'Quarantine tab' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith({ type: 'QUARANTINE_TAB', tabId: 7 });
  });

  it('closes the confirmed tab and clears its assessment', async () => {
    const { sendMessage } = mockChrome();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Popup />);
    await screen.findByRole('heading', { name: 'Automation suspected' });
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    await screen.findByText('Tab closed. An external controller may still operate elsewhere.');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'CLOSE_TAB', tabId: 7 });
    expect(screen.queryByRole('heading', { name: 'Automation suspected' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Close tab' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('releases an existing quarantine and requests the previous page without restoring a stale assessment', async () => {
    const current = dashboard();
    current.quarantines = [{ tabId: 7, domain: 'example.com', createdAt: Date.now(), reason: 'Manual', networkBlocked: false }];
    const { sendMessage } = mockChrome(current);
    render(<Popup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release tab' }));
    await screen.findByText('Containment released. Returning to the previous page.');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'RELEASE_TAB', tabId: 7 });
    expect(screen.queryByRole('heading', { name: 'Automation suspected' })).toBeNull();
  });
});

describe('local console', () => {
  it('explains unavailable debugger access without directing users to another edition', async () => {
    mockChrome();
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Coverage & permissions' }));
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText(/Debugger permission is included in every AgentGuard installation/)).toBeTruthy();
    expect(screen.getByText(/Chrome or organization policy may still restrict debugger access/)).toBeTruthy();
    expect(screen.getByText(/reduced detection coverage, never proof that a tab is human-controlled or safe/)).toBeTruthy();
  });

  it('shows managed locks and validates settings via background save', async () => {
    const { sendMessage } = mockChrome();
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Policy settings' }));
    const mode = screen.getByLabelText(/Policy mode/);
    expect((mode as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Sensitive domains/), { target: { value: 'example.com\ninternal.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SAVE_CONFIG', config: expect.objectContaining({ sensitiveDomains: ['example.com', 'internal.example.org'] }) })));
  });

  it.each(['https://portal.example.com/*', 'https://*/*', 'http://*/*'])('displays Chrome-reported host access %s without requesting or revoking required permissions', async (origin) => {
    const { request, getAll } = mockChrome();
    getAll.mockResolvedValue({ origins: [origin], permissions: [] });
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Coverage & permissions' }));
    await screen.findByText(origin);
    expect(screen.getByText(/Required host permissions cannot be removed here/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Grant site|Grant all sites|Revoke http/ })).toBeNull();
    expect(screen.queryByLabelText('Site to monitor')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(chrome.permissions.remove).not.toHaveBeenCalled();
  });

  it.each([[], ['http://*/*'], ['https://*/*']])('explains Chrome access restrictions when reported origins are %j', async (...origins) => {
    const { request, getAll } = mockChrome();
    getAll.mockResolvedValue({ origins, permissions: [] });
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Coverage & permissions' }));
    await screen.findByText(/Chrome site-access settings or organization policy can withhold this access/);
    expect(screen.getByText(/Reported origins alone do not guarantee every tab is observable/)).toBeTruthy();
    if (!origins.length) expect(screen.getByText(/Chrome reports no host access/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Chrome site settings' }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome://extensions/?id=agentguard-test' });
    expect(request).not.toHaveBeenCalled();
  });

  it('requests optional network blocking directly from its enable gesture', async () => {
    const { request } = mockChrome();
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Coverage & permissions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enable network blocking' }));
    expect(request).toHaveBeenCalledWith({ permissions: ['declarativeNetRequestWithHostAccess'] });
    await screen.findByText(/Network blocking permission granted/);
  });

  it('reports denied optional blocking without claiming network containment', async () => {
    const { request } = mockChrome();
    request.mockResolvedValue(false);
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Coverage & permissions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enable network blocking' }));
    await screen.findByText(/Network blocking permission was not granted/);
    expect(screen.getByText('Limited')).toBeTruthy();
  });

  it('revokes only optional network blocking, never required host access', async () => {
    const { getAll } = mockChrome();
    getAll.mockResolvedValue({ origins: ['https://*/*', 'http://*/*'], permissions: ['declarativeNetRequestWithHostAccess'] });
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Coverage & permissions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke network blocking' }));
    await screen.findByText(/Permission revoked/);
    expect(chrome.permissions.remove).toHaveBeenCalledExactlyOnceWith({ permissions: ['declarativeNetRequestWithHostAccess'] });
  });

  it('expires cached overview classifications while preserving historical audit confidence', async () => {
    vi.useFakeTimers();
    const current = dashboard('AUTOMATION_LIKELY');
    current.audit = [{ id: 'audit-1', timestamp: Date.now(), tabId: 7, domain: 'example.com', eventType: 'policy_triggered', detectedAgent: null, confidence: 0.89, policyAction: 'warn', detail: 'Corroborated signals crossed the policy threshold' }];
    mockChrome(current);
    await act(async () => { render(<Options />); });
    const metrics = screen.getByText('Automation likely', { selector: '.eyebrow' }).parentElement!;
    expect(within(metrics).getByText('1')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(within(metrics).getByText('0')).toBeTruthy();
    expect(screen.getByText('Unmonitored')).toBeTruthy();
    expect(screen.getByText(/Some assessments expired/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }));
    expect(screen.getByRole('columnheader', { name: 'Detected agent' })).toBeTruthy();
    expect(screen.getByText('Not identified')).toBeTruthy();
    expect(screen.getByRole('cell', { name: '89 / 100' })).toBeTruthy();
    expect(screen.getByText('Corroborated signals crossed the policy threshold')).toBeTruthy();
  });

  it('does not call local tab data an organization-wide inventory', async () => {
    mockChrome();
    render(<Options />);
    await screen.findByRole('heading', { name: 'Browser overview' });
    expect(await screen.findByText(/No organization-wide agent inventory/)).toBeTruthy();
    expect(document.querySelector('.brand-mark')?.getAttribute('src')).toBe('./icons/icon-128.png');
  });
});

describe('passive debugger history', () => {
  function view(): DebuggerIntelligenceView {
    const now = Date.now();
    return { coverageAvailable: true, lastCapturedAt: now, targets: [{
      targetId: 'target-1', type: 'page', tabId: 7, domain: 'example.com', attached: true, owner: 'unknown',
      firstSeen: now - 1000, lastSeen: now, lastObservedAttachedChange: now - 1000,
      disappearedAt: null, sampledAttachmentStartedAt: now - 1000, sampledAttachmentSpanMs: 1000,
      observationFresh: true, currentAttached: true,
      timeline: [{ type: 'attachment_observed', timestamp: now - 1000 }],
    }] };
  }
  it('separates an observed debugger attachment from controller identity and exact duration', () => {
    render(<DebuggerHistory view={view()} />);
    expect(screen.getByRole('cell', { name: 'Debugger attached' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Unknown' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '1 seconds (sampled)' })).toBeTruthy();
    expect(screen.getByText(/not exact connection duration/)).toBeTruthy();
    expect(screen.getByText(/Ordinary DevTools/)).toBeTruthy();
  });
  it('expires cached attachment claims without another worker response', async () => {
    vi.useFakeTimers();
    render(<DebuggerHistory view={view()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(screen.queryByRole('cell', { name: 'Debugger attached' })).toBeNull();
    expect(screen.getByRole('cell', { name: 'Unavailable' })).toBeTruthy();
  });
  it('does not treat debugger API loss as a detachment', () => {
    render(<DebuggerHistory view={{ ...view(), coverageAvailable: false }} />);
    expect(screen.queryByRole('cell', { name: 'No attachment observed' })).toBeNull();
    expect(screen.getByRole('cell', { name: 'Unavailable' })).toBeTruthy();
  });
});

describe('session console', () => {
  it('shows the effective managed retention instead of hardcoded defaults', async () => {
    const current = dashboard();
    current.config.values = { ...config, sessionRetentionDays: 14, maxHistorySessions: 120 };
    current.config.managedKeys = ['sessionRetentionDays', 'maxHistorySessions'];
    mockChrome(current);
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    await screen.findByText(/up to 14 days, limited to 120 ended sessions/);
    fireEvent.click(screen.getByRole('button', { name: 'Policy settings' }));
    expect((screen.getByLabelText(/Session retention days/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Maximum ended sessions/) as HTMLInputElement).disabled).toBe(true);
  });

  it('saves local history limits without changing the audit limits', async () => {
    const { sendMessage } = mockChrome();
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Policy settings' }));
    fireEvent.change(screen.getByLabelText(/Session retention days/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Maximum ended sessions/), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_CONFIG', config: {
      ...config, sessionRetentionDays: 3, maxHistorySessions: 20,
    } }));
  });

  it('explains when history retention is disabled without implying monitoring is disabled', async () => {
    const current = dashboard();
    current.config.values = { ...config, maxHistorySessions: 0 };
    current.sessions = [session()];
    mockChrome(current);
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    await screen.findByText(/Ended-session history retention is disabled/);
    expect(screen.getByRole('article', { name: 'Current session on example.com, tab 7' })).toBeTruthy();
  });

  it('renders real current and historical sessions with separate controller, framework and timeline claims', async () => {
    const current = dashboard();
    current.sessions = [session()];
    const { sendMessage } = mockChrome(current, [session(true)]);
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    const active = await screen.findByRole('article', { name: 'Current session on example.com, tab 7' });
    const historical = await screen.findByRole('article', { name: 'Historical session on history.example.org, tab 8' });
    expect(within(active).getByText('Unknown')).toBeTruthy();
    expect(within(active).getByText('Playwright-like')).toBeTruthy();
    expect(within(active).getByText('Unverified, not controller identity')).toBeTruthy();
    expect(within(active).getByText('INFERRED')).toBeTruthy();
    expect(within(active).getByText('OBSERVED')).toBeTruthy();
    expect(within(active).getByText(/Counts describe activity in this tab, not proof/)).toBeTruthy();
    expect(within(active).getByText('3')).toBeTruthy();
    expect(within(historical).getByText('Last control score')).toBeTruthy();
    expect(screen.getByText(/limited to 50 ended sessions/)).toBeTruthy();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_SESSION_HISTORY' });
    expect(sendMessage.mock.calls.every(([request]) => ['GET_DASHBOARD', 'GET_SESSION_HISTORY'].includes(request.type))).toBe(true);
  });

  it.each(['missing', 'unmonitored', 'expired'] as const)('does not carry session control claims into %s tab coverage', async (coverage) => {
    const current = dashboard('UNMONITORED');
    current.sessions = [{ ...session(), controlState: 'AGENT_ACTIVE' }];
    if (coverage === 'missing') current.tabs = [];
    if (coverage === 'expired') current.tabs = [{ ...assessment('AGENT_ACTIVE'), expiresAt: Date.now() - 1 }];
    mockChrome(current);
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    const active = await screen.findByRole('article', { name: 'Current session on example.com, tab 7' });
    expect(within(active).getByText('Unmonitored')).toBeTruthy();
    expect(within(active).queryByText('Automation active')).toBeNull();
    expect(within(active).getByText('Unavailable')).toBeTruthy();
    expect(within(active).getByText(/not current control/)).toBeTruthy();
  });

  it('does not report empty history when retrieval fails and allows a read-only retry', async () => {
    const { sendMessage } = mockChrome();
    const original = sendMessage.getMockImplementation()!;
    let unavailable = true;
    sendMessage.mockImplementation(async (request) => request.type === 'GET_SESSION_HISTORY' && unavailable ? { ok: false, error: 'History read failed' } : original(request));
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    await screen.findByText('History read failed');
    expect(screen.getByText('Session history is unavailable.')).toBeTruthy();
    expect(screen.queryByText('No ended session history retained.')).toBeNull();
    unavailable = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
    await screen.findByText('No ended session history retained.');
  });

  it('exports the actual worker session report as a local JSON download', async () => {
    const current = dashboard();
    current.sessions = [session()];
    const historical = session(true);
    const { sendMessage } = mockChrome(current, [historical]);
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:session-export');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    await screen.findByRole('article', { name: 'Historical session on history.example.org, tab 8' });
    fireEvent.click(screen.getByRole('button', { name: 'Export session JSON' }));
    await screen.findByText(/Exported 1 current and 1 historical sessions/);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'EXPORT_SESSIONS' });
    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe('application/json');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toEqual({ schemaVersion: 1, exportedAt: expect.any(Number), source: 'agentguard-extension', sessions: current.sessions, history: [historical] });
  });

  it('reports export errors without reporting a successful download', async () => {
    const { sendMessage } = mockChrome();
    const original = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation(async (request) => request.type === 'EXPORT_SESSIONS' ? { ok: false, error: 'Session export failed' } : original(request));
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    await screen.findByText('No ended session history retained.');
    fireEvent.click(screen.getByRole('button', { name: 'Export session JSON' }));
    await screen.findByText('Session export failed');
    expect(screen.queryByText(/Exported \d+ current/)).toBeNull();
  });

  it('requires confirmation before clearing ended history and leaves current sessions intact', async () => {
    const current = dashboard();
    current.sessions = [session()];
    const { sendMessage } = mockChrome(current, [session(true)]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    await screen.findByRole('article', { name: 'Historical session on history.example.org, tab 8' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear ended history' }));
    expect(sendMessage).not.toHaveBeenCalledWith({ type: 'CLEAR_SESSION_HISTORY' });
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear ended history' }));
    await screen.findByText('Ended session history cleared. Current sessions are unchanged.');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_SESSION_HISTORY' });
    expect(screen.getByRole('article', { name: 'Current session on example.com, tab 7' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Historical session on history.example.org, tab 8' })).toBeNull();
  });

  it('preserves displayed history when clearing fails', async () => {
    const { sendMessage } = mockChrome(dashboard(), [session(true)]);
    const original = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation(async (request) => request.type === 'CLEAR_SESSION_HISTORY' ? { ok: false, error: 'Clear history failed' } : original(request));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Options />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));
    await screen.findByRole('article', { name: 'Historical session on history.example.org, tab 8' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear ended history' }));
    await screen.findByText('Clear history failed');
    expect(screen.getByRole('article', { name: 'Historical session on history.example.org, tab 8' })).toBeTruthy();
    expect(screen.queryByText(/Ended session history cleared/)).toBeNull();
  });
});

describe('quarantine page', () => {
  it('does not claim quarantine before loading or when no record exists', async () => {
    mockChrome();
    render(<Blocked />);
    expect(screen.getByRole('heading', { name: 'Checking containment' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'This tab is quarantined' })).toBeNull();
    await screen.findByRole('heading', { name: 'Containment not confirmed' });
    expect(screen.queryByRole('button', { name: 'Release this tab' })).toBeNull();
    expect(document.querySelector('.brand-mark')?.getAttribute('src')).toBe('./icons/icon-128.png');
    expect(screen.getByText(/No active quarantine record was found/)).toBeTruthy();
  });

  it('does not claim quarantine if its status request fails', async () => {
    const { sendMessage } = mockChrome();
    sendMessage.mockResolvedValue({ ok: false, error: 'Status unavailable' });
    render(<Blocked />);
    await screen.findByRole('heading', { name: 'Containment not confirmed' });
    expect(screen.getByRole('alert').textContent).toBe('Status unavailable');
  });

  it('shows the actual record and returns through Chrome history on release', async () => {
    const current = dashboard();
    current.quarantines = [{ tabId: 7, domain: 'example.com', createdAt: 1_700_000_000_000, reason: 'Policy threshold', networkBlocked: false }];
    const { sendMessage } = mockChrome(current);
    render(<Blocked />);
    await screen.findByRole('heading', { name: 'This tab is quarantined' });
    expect(document.querySelector('.brand-mark')?.getAttribute('src')).toBe('./icons/icon-alert-128.png');
    fireEvent.click(screen.getByRole('button', { name: 'Release this tab' }));
    await screen.findByRole('heading', { name: 'Containment released' });
    expect(document.querySelector('.brand-mark')?.getAttribute('src')).toBe('./icons/icon-128.png');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'RELEASE_TAB', tabId: 7 });
    expect(screen.getByText(/Returning to the previous page using Chrome navigation history/)).toBeTruthy();
  });
  it('offers a return action for a previously released containment page and explains missing history', async () => {
    const { sendMessage } = mockChrome();
    render(<Blocked />);
    await screen.findByRole('heading', { name: 'Containment not confirmed' });
    sendMessage.mockResolvedValue({ ok: true, data: { navigation: 'unavailable' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return to previous page' }));
    await screen.findByRole('heading', { name: 'Containment released' });
    expect(screen.getByText(/Chrome could not return to the previous page/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return to previous page' })).toBeTruthy();
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'RELEASE_TAB', tabId: 7 });
  });
  it('uses User in legacy saved quarantine reasons as well as newly generated copy', async () => {
    const current = dashboard();
    current.quarantines = [{ tabId: 7, domain: 'example.com', createdAt: Date.now(), reason: 'Employee requested emergency quarantine.', networkBlocked: false }];
    mockChrome(current); render(<Blocked />);
    await screen.findByText('User requested emergency quarantine.');
    expect(screen.queryByText('Employee requested emergency quarantine.')).toBeNull();
  });
});
