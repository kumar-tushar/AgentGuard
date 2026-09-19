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
    // real reactive page replacement instead of merely retaining a stale STOP record.
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
    const restoredWorker = context.serviceWorkers().find(item => item.url() === worker.url()) ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
    await expect.poll(() => restoredWorker.evaluate(() => Reflect.has(globalThis, '__agentguardE2EWorkerGeneration__'))).toBe(false);
    await expect.poll(async () => {
      const recorded = await persistedTabs(restoredWorker);
      return ids.every(id => recorded[id]?.status === 'AUTOMATION_LIKELY' && recorded[id]!.assessedAt > restartedAt);
    }).toBe(true);
    await expect.poll(() => restoredWorker.evaluate(async (tabIds) => Promise.all(tabIds.map(tabId => chrome.action.getBadgeText({ tabId }))), ids)).toEqual(['AUTO', 'AUTO', 'AUTO', 'AUTO']);
    await expect.poll(async () => (await persistedSessions(restoredWorker)).filter(session => ids.includes(session.tabId) && session.endedAt === null).map(session => session.id).sort()).toEqual(sessionIds);
    expect(context.pages().some(page => page.url().startsWith(`chrome-extension://${extensionId}/`))).toBe(false);
    expect(await restoredWorker.evaluate(async () => (await chrome.action.getUserSettings()).isOnToolbar)).toBe(false);
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
