import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { resolve } from 'node:path';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Dashboard, Request, Response, ResponseData, TabAgentStatus } from '../../src/shared/contracts';
import type { SessionData } from '../../src/background/session';
import type { AgentSessionData } from '../../src/background/agent-sessions';
import type { SessionReport } from '../../src/shared/intelligence';

async function send<T extends Request>(page: Page, request: T): Promise<ResponseData[T['type']]> {
  const response = await page.evaluate((input) => chrome.runtime.sendMessage(input), request) as Response<ResponseData[T['type']]>;
  expect(response.ok, JSON.stringify(response)).toBe(true);
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

async function recordedTab(page: Page, tabId: number, matches: (tab: TabAgentStatus) => boolean = () => true): Promise<TabAgentStatus> {
  let observed: TabAgentStatus | undefined;
  await expect.poll(async () => {
    observed = (await send(page, { type: 'GET_DASHBOARD' })).tabs.find(tab => tab.tabId === tabId);
    return observed !== undefined && matches(observed);
  }).toBe(true);
  return observed!;
}

async function openExtension(path = resolve('dist'), profile = ''): Promise<{ context: BrowserContext; options: Page; extensionId: string }> {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`, '--enable-unsafe-extension-debugging'],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const extensionId = new URL(worker.url()).hostname;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.getByRole('heading', { name: 'Browser overview' })).toBeVisible();
    const optionsId = await options.evaluate(async () => (await chrome.tabs.getCurrent())!.id!);
    await recordedTab(options, optionsId);
    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    expect(dashboard.config.errors).toEqual([]);
    expect(dashboard.healthErrors).toEqual([]);
    return { context, options, extensionId };
  } catch (error) { await context.close(); throw error; }
}

test('single extension: automatic detection, real policy, quarantine, release and privacy', async ({}, testInfo) => {
  const { context, options, extensionId } = await openExtension();
  try {
    const errors: string[] = [];
    options.on('pageerror', (error) => errors.push(error.message));
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>PRIVATE_FIXTURE_TITLE</title><h1>Automation test fixture</h1><input type="password" value="PRIVATE_FIXTURE_PASSWORD"><button>Fixture action</button>',
    }));
    await site.goto('http://127.0.0.1/account/PRIVATE_FIXTURE_PATH?token=PRIVATE_FIXTURE_TOKEN');
    await site.bringToFront();
    const browserSession = await context.browser()!.newBrowserCDPSession();
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith('http://127.0.0.1/'))?.id);
    expect(tabId).toBeDefined();
    const assessment = await recordedTab(options, tabId!, tab => tab.coverage.find(item => item.detector === 'debugger')?.availability === 'available');
    const attached = (await options.evaluate(() => chrome.debugger.getTargets())).find((item) => item.tabId === tabId)?.attached;
    expect(typeof attached).toBe('boolean');
    expect(assessment.status).toBe('AUTOMATION_LIKELY');
    expect(assessment.confidence).toBe(attached ? 0.8884 : 0.82);
    expect(assessment.identifiedAgent).toBeNull();
    expect(assessment.domain).toBe('127.0.0.1');
    expect(assessment.evidence.some((item) => item.detector === 'webdriver' && item.metadata.webdriver === true)).toBe(true);
    expect(assessment.coverage.find((item) => item.detector === 'debugger')?.availability).toBe('available');
    expect(assessment.evidence.some((item) => item.detector === 'debugger' && item.metadata.attached === true)).toBe(attached);
    // Render the packaged popup in an inactive tab because native action popups
    // are not exposed as Playwright pages. Detection has already happened with no action click.
    const popupOpened = context.waitForEvent('page');
    await options.evaluate((url) => chrome.tabs.create({ url, active: false }), `chrome-extension://${extensionId}/popup.html`);
    const popup = await popupOpened;
    await expect(popup.getByRole('heading', { name: 'Automation likely' })).toBeVisible();
    await popup.setViewportSize({ width: 420, height: 800 });
    await popup.screenshot({ path: testInfo.outputPath('popup.png'), fullPage: true });

    // Exercise the packaged policy editor against the actual service worker and storage.
    await options.bringToFront();
    await options.getByRole('button', { name: 'Policy settings', exact: true }).click();
    await options.getByLabel(/Policy mode/).selectOption('warn');
    await options.getByLabel(/Sensitive domains/).fill('127.0.0.1');
    await options.getByRole('button', { name: 'Save policy' }).click();
    await expect(options.getByText(/Settings saved/)).toBeVisible();
    const warned = await recordedTab(options, tabId!, tab => tab.policy.action === 'warn');
    expect(warned.policy.action).toBe('warn');
    await options.screenshot({ path: testInfo.outputPath('policy.png'), fullPage: true });

    const quarantine = await send(options, { type: 'QUARANTINE_TAB', tabId: tabId! });
    expect(quarantine.networkBlocked).toBe(false);
    await expect(site).toHaveURL(`chrome-extension://${extensionId}/blocked.html`);
    await expect(site.getByRole('heading', { name: 'This tab is quarantined' })).toBeVisible();
    await expect(site.getByText('127.0.0.1', { exact: true })).toBeVisible();
    await site.screenshot({ path: testInfo.outputPath('quarantined.png'), fullPage: true });

    // Without the optional DNR permission, a same-tab escape still triggers
    // real reactive page replacement instead of merely retaining a stale containment record.
    await site.goto('http://127.0.0.1/attempted-return').catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes('ERR_ABORTED')) throw error;
    });
    await expect(site).toHaveURL(`chrome-extension://${extensionId}/blocked.html`);
    await expect(site.getByRole('button', { name: 'Release this tab' })).toBeVisible();

    // Terminating just the worker exercises session rehydration without a browser restart.
    const { targetInfos } = await browserSession.send('Target.getTargets');
    const workerTarget = targetInfos.find((item) => item.type === 'service_worker' && item.url.startsWith(`chrome-extension://${extensionId}/`));
    expect(workerTarget).toBeDefined();
    await browserSession.send('Target.closeTarget', { targetId: workerTarget!.targetId });
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).quarantines.length).toBe(1);

    await site.getByRole('button', { name: 'Release this tab' }).click();
    await expect(site.getByRole('heading', { name: 'Containment released' })).toBeVisible();
    const dashboard: Dashboard = await send(options, { type: 'GET_DASHBOARD' });
    expect(dashboard.quarantines).toHaveLength(0);
    expect(dashboard.config.values.policyMode).toBe('warn');
    expect(dashboard.audit.map((event) => event.eventType)).toEqual(expect.arrayContaining(['policy_triggered', 'quarantined', 'released']));
    const persisted = await options.evaluate(async () => ({
      local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null),
    }));
    expect(JSON.stringify(persisted)).not.toContain('PRIVATE_FIXTURE_');
    expect(JSON.stringify(persisted)).not.toContain('/account/');
    const exported = await send(options, { type: 'EXPORT_AUDIT' });
    expect(exported.source).toBe('agentguard-extension');
    expect(exported.events.every((event) => event.detectedAgent === null)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('full browser restart archives prior sessions without rebinding their tab identities', async ({}, testInfo) => {
  const profile = testInfo.outputPath('restart-profile');
  const first = await openExtension(resolve('dist'), profile);
  let previousId: string;
  try {
    const site = await first.context.newPage();
    await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Restart fixture</h1>' }));
    await site.goto('http://127.0.0.1/PRIVATE_RESTART_PATH?secret=PRIVATE_RESTART_TOKEN');
    await expect.poll(async () => (await send(first.options, { type: 'GET_DASHBOARD' })).sessions.length).toBe(1);
    previousId = (await send(first.options, { type: 'GET_DASHBOARD' })).sessions[0]!.id;
    await expect.poll(() => first.options.evaluate(async id => {
      const data = (await chrome.storage.local.get('agentguard.agent-history.v1'))['agentguard.agent-history.v1'] as AgentSessionData;
      return data.sessions.some(session => session.id === id && session.active);
    }, previousId)).toBe(true);
  } finally { await first.context.close(); }
  const second = await openExtension(resolve('dist'), profile);
  try {
    const history = await send(second.options, { type: 'GET_SESSION_HISTORY' });
    expect(history.find(session => session.id === previousId!)).toMatchObject({ active: false, endReason: 'browser_restart', domain: '127.0.0.1' });
    expect((await send(second.options, { type: 'GET_DASHBOARD' })).sessions.some(session => session.id === previousId!)).toBe(false);
    expect(JSON.stringify(history)).not.toMatch(/PRIVATE_RESTART_PATH|PRIVATE_RESTART_TOKEN/);
  } finally { await second.context.close(); }
});

test('optional permissions granted: real DNR blocking, tab isolation, automatic sensitive-domain quarantine', async ({}, testInfo) => {
  // A disposable permission-granted manifest avoids automating native consent dialogs.
  // Every executable byte is copied unchanged from the single production build.
  const fixture = testInfo.outputPath('granted-extension');
  await cp(resolve('dist'), fixture, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(fixture, 'manifest.json'), 'utf8')) as chrome.runtime.ManifestV3;
  manifest.permissions = [...(manifest.permissions ?? []), 'declarativeNetRequestWithHostAccess'];
  manifest.optional_permissions = [];
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(resolve(fixture, 'manifest.json'), JSON.stringify(manifest));
  let requests = 0;
  const server = createServer((_, response) => {
    requests += 1;
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><h1>Local containment fixture</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local server did not start');
  const url = `http://127.0.0.1:${address.port}/`;
  const { context, options, extensionId } = await openExtension(fixture);
  try {
    const site = await context.newPage();
    await site.goto(url);
    const id = await options.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, url);
    expect(id).toBeDefined();
    const record = await send(options, { type: 'QUARANTINE_TAB', tabId: id! });
    expect(record.networkBlocked).toBe(true);
    await expect(site).toHaveURL(`chrome-extension://${extensionId}/blocked.html`);
    const rules = await options.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    expect(rules).toHaveLength(1);
    expect(rules[0]?.condition.tabIds).toEqual([id]);
    const before = requests;
    await expect(site.goto(`${url}blocked-request`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    expect(requests).toBe(before);
    const other = await context.newPage();
    await other.goto(`${url}another-tab`);
    await expect(other.getByRole('heading', { name: 'Local containment fixture' })).toBeVisible();
    expect(requests).toBeGreaterThan(before);
    await send(options, { type: 'RELEASE_TAB', tabId: id! });
    expect(await options.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).toEqual([]);
    await site.goto(`${url}released`);
    await expect(site.getByRole('heading', { name: 'Local containment fixture' })).toBeVisible();

    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    await send(options, { type: 'SAVE_CONFIG', config: {
      ...dashboard.config.values, sensitiveDomains: ['127.0.0.1'], policyMode: 'block', minimumConfidence: 0.75,
    } });
    // A real background refresh must quarantine based on detected WebDriver evidence.
    await expect(site).toHaveURL(`chrome-extension://${extensionId}/blocked.html`);
    await expect(site.getByRole('heading', { name: 'This tab is quarantined' })).toBeVisible();
    const after = await send(options, { type: 'GET_DASHBOARD' });
    expect(after.audit.some((event) => event.eventType === 'policy_triggered' && event.policyAction === 'quarantine')).toBe(true);
    await send(options, { type: 'CLOSE_TAB', tabId: id! });
    await expect.poll(() => site.isClosed()).toBe(true);
    expect((await options.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).some((rule) => rule.condition.tabIds?.includes(id!))).toBe(false);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('real Playwright binding registry fixture remains a framework hint, never an identified AI controller', async () => {
  const { context, options } = await openExtension();
  try {
    const site = await context.newPage();
    await site.exposeBinding('agentGuardBindingFixture', () => true);
    await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Runtime fixture</h1>' }));
    await site.goto('http://127.0.0.1/PRIVATE_BINDING_PATH?token=PRIVATE_BINDING_TOKEN');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.includes('PRIVATE_BINDING_PATH'))!.id!);
    const detected = await recordedTab(options, tabId, tab => tab.evidence.some(item => item.metadata.marker === 'playwright-binding'));
    expect(detected.identifiedAgent).toBeNull();
    expect(detected.frameworkHints).toEqual(['Playwright-like marker']);
    expect(detected.evidence.find(item => item.detector === 'fingerprint')).toMatchObject({ confidence: 0.34, metadata: { marker: 'playwright-binding' } });
    // These are genuinely installed by Playwright exposeBinding, not spoofed marker fixtures.
    expect(await site.evaluate(() => ['__playwright__binding__', '__playwright__binding__controller__']
      .map(name => Object.prototype.hasOwnProperty.call(globalThis, name)))).toEqual([true, true]);
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).sessions.find(session => session.tabId === tabId)?.automationStack.frameworks).toEqual(['Playwright-like']);
    // Hiding the standard flag cannot promote a framework hint into confirmed agent control.
    await site.evaluate(() => {
      Object.defineProperty(navigator, 'webdriver', { value: false });
      location.hash = 'webdriver-hidden';
    });
    const hintOnly = await recordedTab(options, tabId, tab => tab.assessedAt > detected.assessedAt && tab.status === 'AUTOMATION_SUSPECTED');
    expect(hintOnly.identifiedAgent).toBeNull();
    expect(hintOnly.evidence.some(item => item.detector === 'webdriver')).toBe(false);
    expect(hintOnly.evidence.filter(item => item.detector === 'fingerprint')).toHaveLength(1);
    expect(hintOnly.confidence).toBe(hintOnly.evidence.some(item => item.detector === 'debugger') ? 0.5908 : 0.34);
    const sessions = await send(options, { type: 'EXPORT_SESSIONS' });
    expect(JSON.stringify(sessions)).not.toMatch(/PRIVATE_BINDING|Microsoft|agentGuardBindingFixture/);
    expect(sessions.sessions.find(session => session.tabId === tabId)?.controller.displayName).toBeNull();
  } finally { await context.close(); }
});

test('single extension passively reports debugger attachment evidence without identity claims', async () => {
  const { context, options } = await openExtension();
  try {
    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    expect(dashboard.capabilities.debugger).toBe(true);
    const targets = await options.evaluate(() => chrome.debugger.getTargets());
    expect(targets.some((target) => target.type === 'page')).toBe(true);
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Debugger fixture</h1>' }));
    await site.goto('http://127.0.0.1/debugger');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url === 'http://127.0.0.1/debugger')?.id);
    expect(tabId).toBeDefined();
    const result = await recordedTab(options, tabId!, tab => tab.coverage.find(item => item.detector === 'debugger')?.availability === 'available');
    expect(result.coverage.find((item) => item.detector === 'debugger')?.availability).toBe('available');
    expect(result.identifiedAgent).toBeNull();
    const attached = (await options.evaluate(() => chrome.debugger.getTargets())).find((item) => item.tabId === tabId)?.attached;
    expect(typeof attached).toBe('boolean');
    expect(result.evidence.some((item) => item.detector === 'debugger')).toBe(attached);
    expect(result.status).toBe('AUTOMATION_LIKELY');
    expect(result.confidence).toBe(attached ? 0.8884 : 0.82);
    const history = (await send(options, { type: 'GET_DASHBOARD' })).debuggerIntelligence;
    const observedTarget = history.targets.find(target => target.tabId === tabId);
    expect(history.coverageAvailable).toBe(true);
    expect(observedTarget).toMatchObject({ type: 'page', domain: '127.0.0.1', owner: 'unknown',
      currentAttached: attached, observationFresh: true, disappearedAt: null });
    expect(observedTarget!.timeline.some(event => event.type === 'target_seen')).toBe(true);
    await options.getByRole('button', { name: 'Refresh data', exact: true }).click();
    await options.getByRole('button', { name: 'Coverage & permissions', exact: true }).click();
    const panel = options.getByRole('region', { name: 'Debugger observation history' });
    const row = panel.getByRole('row').filter({ hasText: observedTarget!.targetId });
    await expect(row.getByRole('cell', { name: 'Unknown', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: attached ? 'Debugger attached' : 'No attachment observed', exact: true })).toBeVisible();
    await expect(panel.getByText(/not exact connection duration/)).toBeVisible();
    await site.close();
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).debuggerIntelligence.targets
      .find(target => target.targetId === observedTarget!.targetId)?.disappearedAt).toEqual(expect.any(Number));
    const disappeared = (await send(options, { type: 'GET_DASHBOARD' })).debuggerIntelligence.targets.find(target => target.targetId === observedTarget!.targetId);
    expect(disappeared).toMatchObject({ currentAttached: null, observationFresh: false, owner: 'unknown' });
    expect(disappeared!.timeline.at(-1)?.type).toBe('target_disappeared');
  } finally { await context.close(); }
});

test('restricted pages remain UNMONITORED despite required HTTP(S) monitoring access', async () => {
  const { context, options } = await openExtension();
  try {
    const id = await options.evaluate(async () => (await chrome.tabs.getCurrent())!.id!);
    const restricted = await recordedTab(options, id);
    expect(restricted.status).toBe('UNMONITORED');
    expect(restricted.confidence).toBe(0);
    expect(restricted.evidence).toEqual([]);
    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    expect([...dashboard.capabilities.origins].sort()).toEqual(['http://*/*', 'https://*/*']);
    expect(dashboard.capabilities.debugger).toBe(true);
    expect(dashboard.capabilities.networkBlocking).toBe(false);
  } finally { await context.close(); }
});

test('simulated debugger policy denial reports reduced coverage without erasing evidence or claiming NO_AUTOMATION_OBSERVED', async () => {
  const { context, options } = await openExtension();
  try {
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><button>Trusted interaction</button>',
    }));
    await site.goto('http://127.0.0.1/debugger-denied');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url === 'http://127.0.0.1/debugger-denied')?.id);
    expect(tabId).toBeDefined();
    await recordedTab(options, tabId!, tab => tab.status === 'AUTOMATION_LIKELY');

    const beforeDenial = (await send(options, { type: 'GET_DASHBOARD' })).debuggerIntelligence.targets.find(target => target.tabId === tabId);
    expect(beforeDenial).toBeDefined();

    // Simulate rejection at Chrome's API boundary, not in AgentGuard's detectors.
    // Actual organization policy deployment remains a managed-Chrome acceptance check.
    await context.serviceWorkers()[0]!.evaluate(() => {
      chrome.debugger.getTargets = async () => { throw new Error('Debugger access denied by organization policy: PRIVATE_POLICY_DETAIL'); };
    });
    // Real history events ask background monitoring to reconcile. UI reads never trigger a scan.
    await expect.poll(async () => {
      await site.evaluate(() => { location.hash = `coverage-${Date.now()}`; });
      return (await send(options, { type: 'GET_DASHBOARD' })).capabilities.debugger;
    }).toBe(false);
    const automated = await recordedTab(options, tabId!, tab => tab.coverage.find(item => item.detector === 'debugger')?.availability === 'unavailable');
    expect(automated.status).toBe('AUTOMATION_LIKELY');
    expect(automated.confidence).toBe(0.82);
    expect(automated.identifiedAgent).toBeNull();
    expect(automated.evidence.some((item) => item.detector === 'webdriver' && item.metadata.webdriver === true)).toBe(true);
    expect(automated.coverage.find((item) => item.detector === 'debugger')?.availability).toBe('unavailable');

    // A page can hide WebDriver, and browser automation can produce trusted clicks.
    // Neither can turn unavailable debugger coverage into a NO_AUTOMATION_OBSERVED assessment.
    await site.evaluate(() => Object.defineProperty(navigator, 'webdriver', { value: false }));
    await site.getByRole('button', { name: 'Trusted interaction' }).click();
    const reduced = await recordedTab(options, tabId!, tab => tab.status === 'UNMONITORED' && tab.evidence.some(item => item.metadata.signal === 'trusted-activity'));
    expect(reduced.status).toBe('UNMONITORED');
    expect(reduced.confidence).toBe(0);
    expect(reduced.identifiedAgent).toBeNull();
    expect(reduced.evidence.some((item) => item.detector === 'behavior' && item.metadata.signal === 'trusted-activity')).toBe(true);
    expect(reduced.coverage.find((item) => item.detector === 'webdriver')?.availability).toBe('available');
    expect(reduced.coverage.find((item) => item.detector === 'debugger')).toMatchObject({
      availability: 'unavailable', reason: expect.stringMatching(/Chrome|organization policy/),
    });
    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    expect(dashboard.capabilities.debugger).toBe(false);
    expect(dashboard.debuggerIntelligence.coverageAvailable).toBe(false);
    const deniedTarget = dashboard.debuggerIntelligence.targets.find(target => target.targetId === beforeDenial!.targetId);
    expect(deniedTarget).toMatchObject({ currentAttached: null, observationFresh: false, attached: beforeDenial!.attached,
      lastSeen: beforeDenial!.lastSeen, disappearedAt: null, owner: 'unknown' });
    expect(deniedTarget!.timeline.at(-1)?.type).toBe('coverage_lost');
    expect(deniedTarget!.timeline.some(event => event.type === 'detachment_observed' || event.type === 'target_disappeared')).toBe(false);
    await options.getByRole('button', { name: 'Refresh data', exact: true }).click();
    await options.getByRole('button', { name: 'Coverage & permissions', exact: true }).click();
    const historyPanel = options.getByRole('region', { name: 'Debugger observation history' });
    await expect(historyPanel.getByText(/Current target inspection unavailable/)).toBeVisible();
    await expect(historyPanel.getByRole('row').filter({ hasText: deniedTarget!.targetId }).getByRole('cell', { name: 'Unavailable', exact: true })).toBeVisible();
    expect(JSON.stringify({ automated, reduced, dashboard })).not.toContain('PRIVATE_POLICY_DETAIL');
  } finally { await context.close(); }
});

test('four tabs are monitored and recovered after worker restart with the popup unopened and unpinned', async () => {
  const path = resolve('dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`, '--enable-unsafe-extension-debugging'],
  });
  const persistedTabs = (worker: Worker) => worker.evaluate(async () => {
    const stored = (await chrome.storage.session.get('agentguard.session.v1'))['agentguard.session.v1'] as SessionData | undefined;
    return stored?.tabs ?? {};
  });
  const persistedSessions = (worker: Worker) => worker.evaluate(async () => {
    const stored = (await chrome.storage.session.get('agentguard.agent-sessions.v1'))['agentguard.agent-sessions.v1'] as AgentSessionData | undefined;
    return stored?.sessions ?? [];
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const extensionId = new URL(worker.url()).hostname;
    expect(await test.step('Read unpinned action without opening extension UI', () => worker.evaluate(async () => (await chrome.action.getUserSettings()).isOnToolbar))).toBe(false);
    await context.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Background observation fixture</h1><button>Continue</button>' }));
    const sites: Page[] = [];
    for (let index = 0; index < 4; index += 1) {
      const site = await context.newPage();
      await site.goto(`http://127.0.0.1/automatic-${index}`);
      sites.push(site);
    }
    const ids = await worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url?.startsWith('http://127.0.0.1/automatic-')).map(tab => tab.id!));
    expect(ids).toHaveLength(4);
    await expect.poll(async () => {
      const recorded = await persistedTabs(worker);
      return ids.every(id => recorded[id]?.status === 'AUTOMATION_LIKELY' &&
        recorded[id]?.evidence.some(item => item.detector === 'webdriver' && item.metadata.webdriver === true));
    }).toBe(true);
    const beforeRestart = await persistedTabs(worker);
    for (const id of ids) {
      expect(beforeRestart[id]?.identifiedAgent).toBeNull();
      expect(beforeRestart[id]?.domain).toBe('127.0.0.1');
      expect(beforeRestart[id]?.coverage.find(item => item.detector === 'webdriver')?.availability).toBe('available');
    }
    await expect.poll(async () => (await persistedSessions(worker)).filter(session => ids.includes(session.tabId) && session.endedAt === null).length).toBe(4);
    const sessionIds = (await persistedSessions(worker)).filter(session => ids.includes(session.tabId)).map(session => session.id).sort();
    expect(context.pages().some(page => page.url().startsWith(`chrome-extension://${extensionId}/`))).toBe(false);

    // Simulate badges left by a previous extension version. Reconciliation must
    // clear every text overlay without changing the underlying detection state.
    await worker.evaluate(async tabIds => {
      const legacyTexts = ['AUTO', 'WARN', 'STOP', '—'];
      await Promise.all(tabIds.map((tabId, index) => chrome.action.setBadgeText({ tabId, text: legacyTexts[index]! })));
    }, ids);
    expect(await worker.evaluate(async tabIds => Promise.all(tabIds.map(tabId => chrome.action.getBadgeText({ tabId }))), ids))
      .toEqual(['AUTO', 'WARN', 'STOP', '—']);

    const browserSession = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send('Target.getTargets');
    const target = targetInfos.find(item => item.type === 'service_worker' && item.url.startsWith(`chrome-extension://${extensionId}/`));
    expect(target).toBeDefined();
    // Chromium can reuse its worker target (and Playwright Worker object) after a
    // genuine restart. Prove the JS context was reset instead of awaiting a new target.
    await worker.evaluate(() => Reflect.set(globalThis, '__agentguardE2EWorkerGeneration__', true));
    const restartedAt = Date.now();
    await browserSession.send('Target.closeTarget', { targetId: target!.targetId });
    // Tab activation/navigation wakes the worker; no AgentGuard UI or scan message is involved.
    await sites[0]!.bringToFront();
    await sites[0]!.reload();
    let restoredWorker = worker;
    await expect.poll(async () => {
      const candidate = context.serviceWorkers().find(item => item.url() === worker.url());
      if (!candidate) return 'restarting';
      try {
        const hasOldGeneration = await candidate.evaluate(() => Reflect.has(globalThis, '__agentguardE2EWorkerGeneration__'));
        restoredWorker = candidate;
        return hasOldGeneration;
      } catch (error) {
        // The intentional close can race an evaluation while Chrome replaces the context.
        // Only that transition is retried; it cannot satisfy the cleared-sentinel assertion.
        if (error instanceof Error && error.message === 'worker.evaluate: Service worker restarted') return 'restarting';
        throw error;
      }
    }).toBe(false);
    await expect.poll(async () => {
      const recorded = await persistedTabs(restoredWorker);
      return ids.every(id => recorded[id]?.status === 'AUTOMATION_LIKELY' && recorded[id]!.assessedAt > restartedAt);
    }).toBe(true);
    await expect.poll(() => restoredWorker.evaluate(async (tabIds) => Promise.all(tabIds.map(tabId => chrome.action.getBadgeText({ tabId }))), ids)).toEqual(['', '', '', '']);
    await expect.poll(async () => (await persistedSessions(restoredWorker)).filter(session => ids.includes(session.tabId) && session.endedAt === null).map(session => session.id).sort()).toEqual(sessionIds);
    expect(context.pages().some(page => page.url().startsWith(`chrome-extension://${extensionId}/`))).toBe(false);
    expect(await restoredWorker.evaluate(async () => (await chrome.action.getUserSettings()).isOnToolbar)).toBe(false);
  } finally { await context.close(); }
});

test('unpinned cross-tab alerts stack, switch to their source and mute only that tab for 24 hours', async ({}, testInfo) => {
  const path = resolve('dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`, '--enable-unsafe-extension-debugging'],
  });
  try {
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const extensionId = new URL(worker.url()).hostname;
    expect(await worker.evaluate(async () => (await chrome.action.getUserSettings()).isOnToolbar)).toBe(false);
    await context.route(/^http:\/\/(?:127\.0\.0\.1|localhost)\//, route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><h1>Unpinned alert fixture</h1><button>Page action</button>',
    }));
    const site = await context.newPage();
    await site.setViewportSize({ width: 1280, height: 800 });
    await site.goto('http://127.0.0.1/unpinned-alert');
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'http://127.0.0.1/unpinned-alert')!.id!);
    const card = (page: Page, sourceId: number) => page.locator(`[data-agentguard-alert][data-agentguard-tab-id="${sourceId}"]`);
    const alert = card(site, tabId);
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute('role', 'button');
    await expect(alert).toHaveAccessibleName(/AgentGuard: Automation likely/);
    const bounds = (await site.locator('[data-agentguard-alert-stack]').boundingBox())!;
    expect(bounds.x).toBeGreaterThan(1280 / 2);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeLessThan(50);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
    expect(bounds.width).toBeLessThanOrEqual(380);
    expect(bounds.height).toBeLessThanOrEqual(200);
    await site.screenshot({ path: testInfo.outputPath('unpinned-alert.png'), fullPage: true });
    const persistedTab = () => worker.evaluate(async id => {
      const stored = (await chrome.storage.session.get('agentguard.session.v1'))['agentguard.session.v1'] as SessionData;
      return stored.tabs[id];
    }, tabId);
    const mutes = () => worker.evaluate(async () => {
      const data = (await chrome.storage.session.get('agentguard.alert-mutes.v1'))['agentguard.alert-mutes.v1'] as
        { schemaVersion: 1; entries: { tabId: number; mutedUntil: number }[] } | undefined;
      return data?.entries ?? [];
    });
    expect((await persistedTab())?.status).toBe('AUTOMATION_LIKELY');
    expect((await persistedTab())?.evidence.some(item => item.detector === 'webdriver' && item.metadata.webdriver === true)).toBe(true);

    const other = await context.newPage();
    await other.goto('http://localhost/other-tab');
    const otherId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'http://localhost/other-tab')!.id!);
    const remoteOpened = context.waitForEvent('page');
    const remote = await worker.evaluate(async () => {
      // Create the window before navigating so Playwright routing is installed
      // before its first HTTP request; do not depend on a machine-local server.
      const created = await chrome.windows.create({ url: 'about:blank', focused: true });
      if (!created?.tabs?.[0]?.id || created.id === undefined) throw new Error('Separate browser window did not open');
      return { windowId: created.id!, tabId: created.tabs![0]!.id! };
    });
    const remotePage = await remoteOpened;
    await remotePage.goto('http://localhost/remote-tab');
    await expect(remotePage.getByRole('heading', { name: 'Unpinned alert fixture' })).toBeVisible();
    await remotePage.setViewportSize({ width: 1280, height: 800 });
    await expect(remotePage.locator('[data-agentguard-alert]')).toHaveCount(3);
    const remoteCards = await remotePage.locator('[data-agentguard-alert]').all();
    const positions = (await Promise.all(remoteCards.map(element => element.boundingBox()))).map(position => position!).sort((a, b) => a.y - b.y);
    expect(positions[0]!.y).toBeLessThan(50);
    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index]!;
      expect(position.x).toBeGreaterThan(1280 / 2);
      expect(position.width).toBeLessThanOrEqual(380);
      expect(position.height).toBeLessThanOrEqual(200);
      if (index > 0) expect(position.y).toBeGreaterThanOrEqual(positions[index - 1]!.y + positions[index - 1]!.height);
    }
    await expect(card(remotePage, tabId)).toHaveAccessibleName(new RegExp(`Tab ${tabId}\\.`));
    await expect(card(remotePage, otherId)).toHaveAccessibleName(new RegExp(`Tab ${otherId}\\.`));
    await expect(card(remotePage, remote.tabId)).toHaveAccessibleName(new RegExp(`Tab ${remote.tabId}\\.`));
    expect((await remotePage.locator('[data-agentguard-alert]').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).join(' '))
      .not.toMatch(/Click to hide|24 hours|\/unpinned-alert|\/other-tab|\/remote-tab/);
    await remotePage.screenshot({ path: testInfo.outputPath('stacked-alerts.png'), fullPage: true });

    // Page-script dispatch cannot impersonate a trusted user acknowledgement.
    await card(remotePage, tabId).evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await expect(card(remotePage, tabId)).toBeVisible();
    expect((await mutes()).some(entry => entry.tabId === tabId)).toBe(false);
    expect(await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id)).toBe(remote.tabId);
    const clickedAt = Date.now();
    await card(remotePage, tabId).click();
    await expect.poll(() => worker.evaluate(async id => {
      const tab = await chrome.tabs.get(id);
      const window = await chrome.windows.get(tab.windowId);
      return { active: tab.active, focused: window.focused };
    }, tabId)).toEqual({ active: true, focused: true });
    await expect.poll(async () => (await mutes()).find(entry => entry.tabId === tabId)?.mutedUntil).toEqual(expect.any(Number));
    await expect(alert).toHaveCount(0);
    await expect(card(site, otherId)).toBeVisible();
    await expect(card(site, remote.tabId)).toBeVisible();
    expect((await mutes()).some(entry => [otherId, remote.tabId].includes(entry.tabId))).toBe(false);
    const mutedUntil = (await mutes()).find(entry => entry.tabId === tabId)!.mutedUntil;
    expect(mutedUntil).toBeGreaterThanOrEqual(clickedAt + 24 * 60 * 60 * 1000);
    expect(mutedUntil).toBeLessThan(clickedAt + 24 * 60 * 60 * 1000 + 10_000);

    const beforeNavigation = (await persistedTab())!.assessedAt;
    await site.goto('http://localhost/muted-navigation');
    await expect.poll(async () => (await persistedTab())?.assessedAt ?? 0).toBeGreaterThan(beforeNavigation);
    await expect(alert).toHaveCount(0);
    const beforeReload = (await persistedTab())!.assessedAt;
    await site.reload();
    await expect.poll(async () => (await persistedTab())?.assessedAt ?? 0).toBeGreaterThan(beforeReload);
    await expect(alert).toHaveCount(0);
    await expect(card(site, otherId)).toBeVisible();
    await remotePage.close();
    await expect(card(site, remote.tabId)).toHaveCount(0);
    await expect(card(site, otherId)).toBeVisible();
    expect(context.pages().some(page => page.url().startsWith(`chrome-extension://${extensionId}/`))).toBe(false);

    const browserSession = await context.browser()!.newBrowserCDPSession();
    const restartWorker = async () => {
      const { targetInfos } = await browserSession.send('Target.getTargets');
      const target = targetInfos.find(item => item.type === 'service_worker' && item.url.startsWith(`chrome-extension://${extensionId}/`));
      expect(target).toBeDefined();
      await worker.evaluate(() => Reflect.set(globalThis, '__agentguardE2EAlertGeneration__', true));
      await browserSession.send('Target.closeTarget', { targetId: target!.targetId });
      await site.bringToFront();
      await site.reload();
      await expect.poll(async () => {
        const candidate = context.serviceWorkers().find(item => item.url() === worker.url());
        if (!candidate) return 'restarting';
        try {
          const hasOldGeneration = await candidate.evaluate(() => Reflect.has(globalThis, '__agentguardE2EAlertGeneration__'));
          worker = candidate;
          return hasOldGeneration;
        } catch (error) {
          if (error instanceof Error && error.message === 'worker.evaluate: Service worker restarted') return 'restarting';
          throw error;
        }
      }).toBe(false);
    };
    const beforeRestart = Date.now();
    await restartWorker();
    await expect.poll(async () => (await persistedTab())?.assessedAt ?? 0).toBeGreaterThan(beforeRestart);
    expect((await mutes()).find(entry => entry.tabId === tabId)?.mutedUntil).toBe(mutedUntil);
    await expect(alert).toHaveCount(0);
    await expect(card(site, otherId)).toBeVisible();

    // Only the mute deadline is a fixture: actual WebDriver evidence and worker
    // reconciliation still determine whether the alert returns after expiry.
    await worker.evaluate(async id => chrome.storage.session.set({
      'agentguard.alert-mutes.v1': { schemaVersion: 1, entries: [{ tabId: id, mutedUntil: Date.now() - 1000 }] },
    }), tabId);
    await restartWorker();
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAccessibleName(/Automation likely/);
    expect((await mutes()).some(entry => entry.tabId === tabId && entry.mutedUntil > Date.now())).toBe(false);
    expect(await worker.evaluate(async () => (await chrome.action.getUserSettings()).isOnToolbar)).toBe(false);
    expect(context.pages().some(page => page.url().startsWith(`chrome-extension://${extensionId}/`))).toBe(false);

    // Disabling monitoring must clear already-rendered notices as well.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    await send(options, { type: 'SAVE_CONFIG', config: { ...dashboard.config.values, monitoringEnabled: false } });
    await expect(alert).toHaveCount(0);
    await expect(site.locator('[data-agentguard-alert-stack]')).toHaveCount(0);
    await expect(other.locator('[data-agentguard-alert]')).toHaveCount(0);
  } finally { await context.close(); }
});

test('real session UI retains ended history, exports privacy-safe records and clears history', async () => {
  const { context, options } = await openExtension();
  try {
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>PRIVATE_SESSION_TITLE</title><h1>Session fixture</h1><input type="password" value="PRIVATE_SESSION_PASSWORD"><button>Continue</button>',
    }));
    await site.goto('http://127.0.0.1/PRIVATE_SESSION_PATH?token=PRIVATE_SESSION_TOKEN');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.includes('PRIVATE_SESSION_PATH'))?.id);
    expect(tabId).toBeDefined();
    await recordedTab(options, tabId!, tab => tab.status === 'AUTOMATION_LIKELY');
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).sessions.some(session => session.tabId === tabId)).toBe(true);
    const current = (await send(options, { type: 'GET_DASHBOARD' })).sessions.find(session => session.tabId === tabId)!;
    expect(current.controller.displayName).toBeNull();
    expect(current.controller.vendor).toBeNull();
    expect(current.controller.product).toBeNull();
    expect(current.controller.confidence).toBe(0);
    expect(current.evidenceIds).toContain('webdriver:webdriver');
    expect(current.automationStack.transports).toContain('WebDriver');
    expect(current.domain).toBe('127.0.0.1');
    expect(current.active).toBe(true);
    expect(current.endedAt).toBeNull();
    expect(current.timeline.some(event => event.type === 'session_started' && event.kind === 'INFERRED')).toBe(true);

    await options.bringToFront();
    await options.getByRole('button', { name: 'Refresh data', exact: true }).click();
    await options.getByRole('button', { name: 'Sessions', exact: true }).click();
    await expect(options.getByRole('heading', { name: 'Automation sessions' })).toBeVisible();
    const currentCard = options.getByRole('article', { name: `Current session on 127.0.0.1, tab ${tabId}` });
    await expect(currentCard).toBeVisible();
    await expect(currentCard.getByText('Unknown', { exact: true })).toBeVisible();
    await currentCard.getByText('Activity and timeline', { exact: true }).click();
    await expect(currentCard.getByText('Automation observation session started', { exact: true })).toBeVisible();
    await expect(currentCard.getByText(/Counts describe activity in this tab, not proof the controller performed it/)).toBeVisible();

    // Native tab closure must end and persist the session without a popup command.
    await site.close();
    await expect.poll(async () => (await send(options, { type: 'GET_SESSION_HISTORY' })).find(session => session.id === current.id)?.endReason).toBe('closed');
    const ended = (await send(options, { type: 'GET_SESSION_HISTORY' })).find(session => session.id === current.id)!;
    expect(ended.active).toBe(false);
    expect(ended.endedAt).toBeGreaterThanOrEqual(current.lastObservedAt);
    expect(ended.timeline.at(-1)).toMatchObject({ type: 'session_ended', kind: 'INFERRED' });
    expect((await send(options, { type: 'GET_DASHBOARD' })).sessions.some(session => session.id === current.id)).toBe(false);
    await options.getByRole('button', { name: 'Refresh history', exact: true }).click();
    await expect(options.getByRole('article', { name: `Historical session on 127.0.0.1, tab ${tabId}` })).toBeVisible();

    const downloadPromise = options.waitForEvent('download');
    await options.getByRole('button', { name: 'Export session JSON', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^agentguard-sessions-\d{4}-\d{2}-\d{2}\.json$/);
    const exportedPath = await download.path();
    expect(exportedPath).not.toBeNull();
    const reportText = await readFile(exportedPath!, 'utf8');
    const report = JSON.parse(reportText) as SessionReport;
    expect(report.schemaVersion).toBe(1);
    expect(report.source).toBe('agentguard-extension');
    expect(report.history.some(session => session.id === current.id && session.endReason === 'closed')).toBe(true);
    expect(reportText).not.toContain('PRIVATE_SESSION_');
    const stored = await options.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    expect(JSON.stringify(stored)).not.toContain('PRIVATE_SESSION_');
    options.once('dialog', dialog => dialog.accept());
    await options.getByRole('button', { name: 'Clear ended history', exact: true }).click();
    await expect(options.getByText('Ended session history cleared. Current sessions are unchanged.', { exact: true })).toBeVisible();
    expect(await send(options, { type: 'GET_SESSION_HISTORY' })).toEqual([]);
    expect((await send(options, { type: 'EXPORT_SESSIONS' })).history).toEqual([]);
  } finally { await context.close(); }
});
