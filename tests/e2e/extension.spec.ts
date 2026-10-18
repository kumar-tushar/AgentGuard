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

test('packaged Orbit Pointer icons have matching green/red silhouettes and transparent cutouts', async () => {
  const { context, options } = await openExtension();
  try {
    const icons = await options.evaluate(async () => {
      const results = [];
      for (const size of [16, 32, 48, 128]) {
        const pair = [];
        for (const prefix of ['icon', 'icon-alert']) {
          const image = new Image(); image.src = `./icons/${prefix}-${size}.png`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
          const drawing = canvas.getContext('2d')!; drawing.drawImage(image, 0, 0);
          const data = drawing.getImageData(0, 0, size, size).data;
          const at = (x: number, y: number) => Array.from(data.slice((Math.floor(y * size) * size + Math.floor(x * size)) * 4, (Math.floor(y * size) * size + Math.floor(x * size)) * 4 + 4));
          pair.push({ width: image.naturalWidth, height: image.naturalHeight, alpha: Array.from(data.filter((_, index) => index % 4 === 3)), center: at(0.5, 0.5), gap: at(0.84, 0.6), ring: at(0.45, 0.08), cursor: at(0.73, 0.72) });
        }
        results.push({ size, green: pair[0]!, red: pair[1]! });
      }
      return results;
    });
    for (const { size, green, red } of icons) {
      expect(green.width).toBe(size); expect(green.height).toBe(size);
      expect(red.width).toBe(size); expect(red.height).toBe(size);
      expect(green.alpha).toEqual(red.alpha);
      for (const icon of [green, red]) {
        expect(icon.center).toEqual([0, 0, 0, 0]); expect(icon.gap).toEqual([0, 0, 0, 0]);
        expect(icon.ring[3]).toBe(255); expect(icon.cursor[3]).toBe(255);
      }
      expect(green.ring[1]!).toBeGreaterThan(green.ring[0]! + 60);
      expect(red.ring[0]!).toBeGreaterThan(red.ring[1]! + 70);
    }
  } finally { await context.close(); }
});

test('single extension: automatic detection, real policy, quarantine, release and privacy', async ({}, testInfo) => {
  const { context, options, extensionId } = await openExtension();
  try {
    await expect(options.locator('.brand-mark')).toHaveAttribute('src', './icons/icon-128.png');
    await expect(options.locator('.brand-mark')).toHaveJSProperty('naturalWidth', 128);
    await expect(options.locator('link[rel="icon"]')).toHaveAttribute('href', './icons/icon-32.png');
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
    await expect(popup.locator('.brand-mark')).toHaveAttribute('src', './icons/icon-alert-128.png');
    await expect(popup.locator('.brand-mark')).toHaveJSProperty('naturalWidth', 128);
    await expect(popup.locator('link[rel="icon"]')).toHaveAttribute('href', './icons/icon-alert-32.png');
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
    await expect(site.locator('.brand-mark')).toHaveAttribute('src', './icons/icon-alert-128.png');
    await expect(site.locator('.brand-mark')).toHaveJSProperty('naturalWidth', 128);
    await expect(site.locator('link[rel="icon"]')).toHaveAttribute('href', './icons/icon-alert-32.png');
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
    await expect(site).toHaveURL('http://127.0.0.1/attempted-return');
    await expect(site.getByRole('heading', { name: 'Automation test fixture' })).toBeVisible();
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
    await recordedTab(options, id!);
    await send(options, { type: 'GRANT_DELEGATION', tabId: id!, preset: 'LIMITED', allowedDomains: ['127.0.0.1'], blockedDomains: ['127.0.0.1'], minutes: 15 });
    expect((await send(options, { type: 'GET_DASHBOARD' })).delegationNetworkTabs).toContain(id!);
    // Remove the page gate for exactly this call: the separate DNR denial must
    // still win. No request may reach the actual server.
    await send(options, { type: 'GRANT_ONCE', tabId: id!, capability: 'network' });
    const beforeDelegationRequest = requests;
    expect(await site.evaluate(async () => { try { await fetch('/delegation-blocked'); return false; } catch { return true; } })).toBe(true);
    expect(requests).toBe(beforeDelegationRequest);
    await send(options, { type: 'REVOKE_DELEGATION', tabId: id! });
    expect(await site.evaluate(() => fetch('/delegation-released').then(response => response.ok))).toBe(true);
    const record = await send(options, { type: 'QUARANTINE_TAB', tabId: id! });
    expect(record.networkBlocked).toBe(true);
    await expect(site).toHaveURL(`chrome-extension://${extensionId}/blocked.html`);
    const rules = await options.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    expect(rules).toHaveLength(1);
    expect(rules[0]?.condition.tabIds).toEqual([id]);
    await send(options, { type: 'RELEASE_TAB', tabId: id! });
    await expect(site).toHaveURL(url);
    await expect(site.getByRole('heading', { name: 'Local containment fixture' })).toBeVisible();
    expect(await options.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).toEqual([]);
    await send(options, { type: 'QUARANTINE_TAB', tabId: id! });
    await expect(site).toHaveURL(`chrome-extension://${extensionId}/blocked.html`);
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

test('release returns the original page after reload and worker restart, with truthful no-history fallback', async () => {
  const { context, options, extensionId } = await openExtension();
  try {
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Original page restored</h1>' }));
    const originalUrl = 'http://127.0.0.1/PRIVATE_RETURN_PATH?token=PRIVATE_RETURN_TOKEN';
    await site.goto(originalUrl);
    const tabId = await options.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, originalUrl);
    await recordedTab(options, tabId!);
    await send(options, { type: 'QUARANTINE_TAB', tabId: tabId! });
    await expect(site.getByText('User requested emergency quarantine.', { exact: true })).toBeVisible();
    await expect(site.getByText('Employee requested emergency quarantine.', { exact: true })).toHaveCount(0);
    await site.reload();
    const browserSession = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send('Target.getTargets');
    const worker = targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`))!;
    await browserSession.send('Target.closeTarget', { targetId: worker.targetId });
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).quarantines.some(record => record.tabId === tabId)).toBe(true);
    await site.getByRole('button', { name: 'Release this tab' }).click();
    await expect(site).toHaveURL(originalUrl);
    await expect(site.getByRole('heading', { name: 'Original page restored' })).toBeVisible();
    expect((await send(options, { type: 'GET_DASHBOARD' })).quarantines.some(record => record.tabId === tabId)).toBe(false);
    const stored = await options.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    expect(JSON.stringify(stored)).not.toContain('PRIVATE_RETURN_');
    await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html`);

    // A directly opened containment URL has no original page to invent.
    const opened = context.waitForEvent('page');
    await options.evaluate(url => chrome.tabs.create({ url, active: false }), `chrome-extension://${extensionId}/blocked.html`);
    const orphan = await opened;
    await expect(orphan.getByRole('heading', { name: 'Containment not confirmed' })).toBeVisible();
    await orphan.getByRole('button', { name: 'Return to previous page' }).click();
    await expect(orphan.getByRole('heading', { name: 'Containment released' })).toBeVisible();
    await expect(orphan.getByText(/Chrome could not return to the previous page/)).toBeVisible();
    await expect(orphan.locator('.brand-mark')).toHaveAttribute('src', './icons/icon-128.png');
    await expect(orphan.locator('link[rel="icon"]')).toHaveAttribute('href', './icons/icon-32.png');
    await expect(orphan.getByRole('button', { name: 'Return to previous page' })).toBeVisible();
  } finally { await context.close(); }
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

test('scrolling and page scripts cannot create automation alerts or policy actions, while real WebDriver evidence still does', async ({}, testInfo) => {
  const { context, options } = await openExtension();
  try {
    // Isolate nonpositive observations from this test harness's own CDP/WebDriver.
    // Events/collectors/worker/UI are real Chromium; this is not proof of human input.
    const worker = context.serviceWorkers()[0]!;
    await worker.evaluate(() => {
      const getTargets = chrome.debugger.getTargets.bind(chrome.debugger);
      chrome.debugger.getTargets = async () => (await getTargets()).map(target => ({ ...target, attached: false }));
    });
    const sites: Page[] = [];
    for (const path of ['activity-source', 'notification-host']) {
      const page = await context.newPage();
      await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true }));
      await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><style>body{height:20000px}button{position:fixed;top:20px}</style><button>Page action</button>',
      }));
      await page.goto(`http://127.0.0.1/${path}`);
      sites.push(page);
    }
    const [source, host] = sites as [Page, Page];
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('http://127.0.0.1/activity-source'))!.id!);
    await source.evaluate(() => { location.hash = 'initialize-coverage'; });
    await recordedTab(options, tabId, tab => tab.status === 'NO_AUTOMATION_OBSERVED');
    const initial = await send(options, { type: 'GET_DASHBOARD' });
    await send(options, { type: 'SAVE_CONFIG', config: { ...initial.config.values, policyMode: 'block', sensitiveDomains: ['127.0.0.1'], minimumConfidence: 0.1 } });
    await source.bringToFront();
    await recordedTab(options, tabId, tab => tab.status === 'NO_AUTOMATION_OBSERVED' && tab.coverage.find(item => item.detector === 'behavior')?.availability === 'available');
    await source.evaluate(async () => {
      for (let step = 0; step < 24; step++) { scrollBy(0, 12); await new Promise(requestAnimationFrame); }
      for (let step = 0; step < 8; step++) document.querySelector('button')!.click();
    });
    const sample = await worker.evaluate(async id => {
      const results = await chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED', func: () => {
        const state = (globalThis as typeof globalThis & { __agentguardBehaviorCollectorV1__?: { samples: { trusted: boolean }[] } }).__agentguardBehaviorCollectorV1__;
        return { trusted: state?.samples.filter(sample => sample.trusted).length ?? 0, synthetic: state?.samples.filter(sample => !sample.trusted).length ?? 0 };
      } });
      return results[0]!.result!;
    }, tabId);
    expect(sample.trusted).toBeGreaterThanOrEqual(12);
    expect(sample.synthetic).toBeGreaterThanOrEqual(8);
    const before = (await recordedTab(options, tabId)).assessedAt;
    await source.evaluate(() => { location.hash = `after-activity-${Date.now()}`; });
    const negative = await recordedTab(options, tabId, tab => tab.assessedAt > before);
    expect(negative.status).toBe('NO_AUTOMATION_OBSERVED');
    expect(negative.confidence).toBe(0);
    expect(negative.evidence.some(item => item.metadata.signal === 'automation-indicator')).toBe(false);
    expect(negative.policy.action).toBe('none');
    await expect(source.locator('[data-agentguard-alert]')).toHaveCount(0);
    await host.bringToFront();
    await expect(host.locator('[data-agentguard-alert]')).toHaveCount(0);
    const normal = await send(options, { type: 'GET_DASHBOARD' });
    expect(normal.quarantines).toEqual([]);
    expect(normal.sessions).toEqual([]);
    expect(normal.statistics?.sessionsObserved).toBe(0);
    expect(normal.audit.some(event => ['policy_triggered', 'quarantined', 'enforcement_failed'].includes(event.eventType))).toBe(false);
    expect(normal.healthErrors).toEqual([]);
    expect(await options.evaluate(id => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe('');
    const popupOpened = context.waitForEvent('page');
    await options.evaluate(url => chrome.tabs.create({ url, active: false }), options.url().replace('options.html', 'popup.html'));
    const popup = await popupOpened;
    await popup.setViewportSize({ width: 400, height: 600 });
    await expect(popup.getByRole('heading', { name: 'No automation observed' })).toBeVisible();
    await expect(popup.locator('.brand-mark')).toHaveAttribute('src', './icons/icon-128.png');
    await popup.screenshot({ path: testInfo.outputPath('normal-activity-popup.png') });

    // Remove only the fixture's flag override: restore Chromium's actual WebDriver value.
    await send(options, { type: 'SAVE_CONFIG', config: { ...normal.config.values, policyMode: 'monitor' } });
    await source.evaluate(() => { Reflect.deleteProperty(navigator, 'webdriver'); location.hash = 'webdriver-restored'; });
    expect(await source.evaluate(() => navigator.webdriver)).toBe(true);
    const positive = await recordedTab(options, tabId, tab => tab.status === 'AUTOMATION_LIKELY');
    expect(positive.confidence).toBe(0.82);
    expect(positive.identifiedAgent).toBeNull();
    expect(positive.evidence.some(item => item.detector === 'webdriver')).toBe(true);
    await source.bringToFront();
    await expect(source.locator('[data-agentguard-alert]')).toHaveCount(1);
    await host.bringToFront();
    await expect(host.locator('[data-agentguard-alert]')).toHaveCount(1);
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).sessions.some(session => session.tabId === tabId)).toBe(true);
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

test('activity samples and per-session reports are real, deduplicated and privacy-minimized', async () => {
  const { context, options } = await openExtension();
  try {
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Activity fixture</h1><input aria-label="Private field" type="password"><button>Continue</button>' }));
    await site.goto('http://127.0.0.1/PRIVATE_REPORT_PATH?token=PRIVATE_REPORT_TOKEN');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.includes('PRIVATE_REPORT_PATH'))?.id);
    await recordedTab(options, tabId!, tab => tab.status === 'AUTOMATION_LIKELY');
    await site.getByLabel('Private field').pressSequentially('PRIVATE_REPORT_PASSWORD');
    await site.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).sessions.find(session => session.tabId === tabId)?.observedActivity.keyboardInteractions ?? 0).toBeGreaterThan(0);
    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    const session = dashboard.sessions.find(item => item.tabId === tabId)!;
    const report = await send(options, { type: 'GET_SESSION_REPORT', sessionId: session.id });
    expect(report.activity.keyboardInteractions).toBeGreaterThan(0);
    expect(report.controller).toBeNull();
    expect(report.coverageNote).toContain('zero counts do not establish inactivity');
    await options.bringToFront();
    await options.getByRole('button', { name: 'Refresh data', exact: true }).click();
    await options.getByRole('button', { name: 'Sessions', exact: true }).click();
    const card = options.getByRole('article', { name: `Current session on 127.0.0.1, tab ${tabId}` });
    await card.getByRole('button', { name: 'View report', exact: true }).click();
    await expect(card.getByRole('region', { name: 'Session report' })).toBeVisible();
    await expect(card.getByText(report.coverageNote, { exact: true })).toBeVisible();
    const stored = await options.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    expect(JSON.stringify({ stored, report })).not.toContain('PRIVATE_REPORT_');
    expect((await send(options, { type: 'GET_DASHBOARD' })).sessions.find(item => item.tabId === tabId)?.id).toBe(session.id);
  } finally { await context.close(); }
});

test('delegation blocks selected synthetic input, pauses and resumes without disabling detection', async () => {
  const { context, options } = await openExtension();
  try {
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Delegation fixture</h1><button>Continue</button>' }));
    await site.goto('http://127.0.0.1/delegation');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'http://127.0.0.1/delegation')?.id);
    await recordedTab(options, tabId!, tab => tab.status === 'AUTOMATION_LIKELY');
    await options.getByRole('button', { name: 'Agent controls', exact: true }).click();
    await options.getByLabel('Controlled tab', { exact: true }).selectOption(String(tabId));
    await options.getByRole('button', { name: 'Apply delegation', exact: true }).click();
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).controls?.grants.find(grant => grant.tabId === tabId)?.preset).toBe('READ_ONLY');
    const prevented = () => site.evaluate(() => { const event = new MouseEvent('click', { bubbles: true, cancelable: true }); document.querySelector('button')!.dispatchEvent(event); return event.defaultPrevented; });
    await expect.poll(prevented).toBe(true);
    await send(options, { type: 'GRANT_ONCE', tabId: tabId!, capability: 'click' });
    expect(await prevented()).toBe(false);
    expect(await prevented()).toBe(true);
    const pause = await send(options, { type: 'PAUSE_CONTROLS', domain: '127.0.0.1', minutes: 15 });
    expect(await prevented()).toBe(false);
    expect((await send(options, { type: 'GET_DASHBOARD' })).config.values.monitoringEnabled).toBe(true);
    await send(options, { type: 'RESUME_CONTROLS', pauseId: pause.pauses[0]!.id });
    expect(await prevented()).toBe(true);
    await send(options, { type: 'REVOKE_DELEGATION', tabId: tabId! });
    expect(await prevented()).toBe(false);
  } finally { await context.close(); }
});

test('emergency containment records actual multi-tab outcomes, survives worker restart and resets explicitly', async () => {
  const { context, options, extensionId } = await openExtension();
  try {
    const sites = await Promise.all([context.newPage(), context.newPage()]);
    for (let index = 0; index < sites.length; index++) {
      const site = sites[index]!;
      await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Emergency fixture</h1>' }));
      await site.goto(`http://127.0.0.1/emergency-${index}`);
    }
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).sessions.length).toBe(2);
    await options.bringToFront();
    options.once('dialog', dialog => dialog.accept());
    await options.getByRole('button', { name: 'Contain detected tabs', exact: true }).click();
    for (const site of sites) await expect(site).toHaveURL(`chrome-extension://${extensionId}/blocked.html`);
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).emergency?.outcomes.filter(item => item.result === 'confirmed').length).toBe(2);
    const browserSession = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send('Target.getTargets');
    const worker = targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`))!;
    await browserSession.send('Target.closeTarget', { targetId: worker.targetId });
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).emergency?.active).toBe(true);
    expect((await send(options, { type: 'GET_DASHBOARD' })).emergency?.outcomes).toHaveLength(2);
    await send(options, { type: 'EMERGENCY_RESET' });
    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    expect(dashboard.emergency?.active).toBe(false);
    expect(dashboard.quarantines).toHaveLength(2);
    const commands = await options.evaluate(() => chrome.commands.getAll());
    expect(commands.some(command => command.name === 'emergency-contain')).toBe(true);
  } finally { await context.close(); }
});

test('explicit traffic observation records hostname metadata without scoring its own debugger session', async () => {
  const { context, options, extensionId } = await openExtension();
  try {
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Traffic fixture</h1>' }));
    await site.goto('http://127.0.0.1/traffic');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'http://127.0.0.1/traffic')?.id);
    await recordedTab(options, tabId!);
    const view = await send(options, { type: 'START_OBSERVATION', tabId: tabId! });
    expect(view.leases.find(lease => lease.tabId === tabId)?.state).toBe('observing');
    await site.evaluate(() => fetch('/PRIVATE_TRAFFIC?token=PRIVATE_TOKEN', { method: 'POST', headers: { 'X-Fixture': 'PRIVATE_HEADER' }, body: 'PRIVATE_BODY' }).then(response => response.text()));
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).traffic?.records.filter(record => record.tabId === tabId && record.kind === 'request').length ?? 0).toBeGreaterThan(0);
    const dashboard = await send(options, { type: 'GET_DASHBOARD' });
    expect(JSON.stringify(dashboard.traffic)).not.toContain('PRIVATE_');
    await recordedTab(options, tabId!, tab => tab.coverage.some(item => item.detector === 'debugger' && item.availability === 'unavailable'));
    expect((await send(options, { type: 'GET_DASHBOARD' })).tabs.find(tab => tab.tabId === tabId)?.evidence.some(item => item.detector === 'debugger')).toBe(false);
    await send(options, { type: 'STOP_OBSERVATION', tabId: tabId! });
    expect((await send(options, { type: 'GET_DASHBOARD' })).traffic?.leases).toEqual([]);
    await send(options, { type: 'START_OBSERVATION', tabId: tabId! });
    const browserSession = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send('Target.getTargets');
    const worker = targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`))!;
    await browserSession.send('Target.closeTarget', { targetId: worker.targetId });
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).traffic?.leases).toEqual([]);
    expect(await options.evaluate(async () => (await chrome.storage.session.get('agentguard.observation-owners.v1'))['agentguard.observation-owners.v1'])).toEqual([]);
  } finally { await context.close(); }
});

test('opt-in stack hints recognize real Playwright calls without changing controller identity', async () => {
  const { context, options } = await openExtension();
  try {
    const config = (await send(options, { type: 'GET_DASHBOARD' })).config.values;
    await send(options, { type: 'SAVE_CONFIG', config: { ...config, stackSignalsEnabled: true } });
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Stack fixture</h1>' }));
    await site.goto('http://127.0.0.1/stack');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'http://127.0.0.1/stack')?.id);
    await recordedTab(options, tabId!);
    await site.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<span>Fixture action</span>'));
    await options.bringToFront(); await site.bringToFront();
    const tab = await recordedTab(options, tabId!, tab => tab.evidence.some(item => item.metadata.marker === 'playwright-stack'));
    expect(tab.identifiedAgent).toBeNull();
    expect(tab.frameworkHints).toContain('Playwright-like call stack');
    expect((await send(options, { type: 'GET_DASHBOARD' })).sessions.find(session => session.tabId === tabId)?.controller.product).toBeNull();
  } finally { await context.close(); }
});

test('explicit global download cancellation confirms Chrome outcomes without guessing an agent tab', async ({}, testInfo) => {
  const fixture = testInfo.outputPath('download-permission-extension');
  await cp(resolve('dist'), fixture, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(fixture, 'manifest.json'), 'utf8')) as chrome.runtime.ManifestV3;
  manifest.permissions = [...(manifest.permissions ?? []), 'downloads'];
  manifest.optional_permissions = manifest.optional_permissions?.filter(permission => permission !== 'downloads');
  await writeFile(resolve(fixture, 'manifest.json'), JSON.stringify(manifest));
  const server = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="PRIVATE_FILENAME.txt"', 'Content-Length': '1000000' });
    response.write('fixture');
    const timer = setInterval(() => response.write('fixture'), 100);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Download fixture did not start');
  const { context, options } = await openExtension(fixture);
  try {
    const config = (await send(options, { type: 'GET_DASHBOARD' })).config.values;
    await send(options, { type: 'SAVE_CONFIG', config: { ...config, downloadPolicy: 'block_all' } });
    const id = await options.evaluate(port => chrome.downloads.download({ url: `http://127.0.0.1:${port}/PRIVATE_DOWNLOAD?token=PRIVATE_TOKEN`, saveAs: false }), address.port);
    await expect.poll(async () => (await send(options, { type: 'GET_DASHBOARD' })).downloads?.find(record => record.id === id)?.action).toBe('cancel_confirmed');
    const records = (await send(options, { type: 'GET_DASHBOARD' })).downloads!;
    expect(records.find(record => record.id === id)).toMatchObject({ domain: '127.0.0.1', tabId: null, initiator: 'unknown' });
    expect(JSON.stringify(records)).not.toContain('PRIVATE_');
    const items = await options.evaluate(id => chrome.downloads.search({ id }), id);
    expect(items[0]?.state).toBe('interrupted');
    expect(items[0]?.error).toBe('USER_CANCELED');
    await send(options, { type: 'CLEAR_TRAFFIC' });
    expect((await send(options, { type: 'GET_DASHBOARD' })).downloads).toEqual([]);
  } finally { await context.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('dark UI stays readable, aligned and keyboard-accessible across desktop, narrow settings and popup layouts', async ({}, testInfo) => {
  const { context, options, extensionId } = await openExtension();
  const noOverflow = async (page: Page) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const clipped = await page.locator('.panel, .console-panel, .metric-card, .field input, .field select, .field textarea').evaluateAll(elements => elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).map(element => element.className));
    expect(clipped).toEqual([]);
  };
  try {
    await options.emulateMedia({ reducedMotion: 'reduce' });
    const site = await context.newPage();
    await site.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Layout fixture</h1>' }));
    await site.goto('http://127.0.0.1/layout');
    const tabId = await options.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === 'http://127.0.0.1/layout')!.id!);
    await recordedTab(options, tabId);

    for (const width of [1440, 800, 390]) {
      await options.setViewportSize({ width, height: 1000 });
      for (const label of ['Overview', 'Sessions', 'Agent controls', 'Traffic & alerts', 'External services', 'Policy settings', 'Coverage & permissions', 'Audit log']) {
        const button = options.getByRole('button', { name: label, exact: true });
        await button.click();
        await expect(button).toHaveAttribute('aria-current', 'page');
        await expect(options.getByRole('button', { name: 'Refresh data', exact: true })).toBeEnabled();
        await noOverflow(options);
      }
      if (width !== 800) {
        await options.getByRole('button', { name: 'Overview', exact: true }).click();
        if (width === 390) expect(await options.locator('.table-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        await options.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true });
        await options.getByRole('button', { name: 'Policy settings', exact: true }).click();
        await options.screenshot({ path: testInfo.outputPath(`policy-${width}.png`), fullPage: true });
      }
    }
    await options.setViewportSize({ width: 1440, height: 1000 });
    await options.getByRole('button', { name: 'Overview', exact: true }).focus();
    await options.keyboard.press('Tab');
    await expect(options.getByRole('button', { name: 'Sessions', exact: true })).toBeFocused();
    await expect(options.getByRole('button', { name: 'Sessions', exact: true })).toHaveCSS('outline-style', 'solid');
    expect(await options.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
    const contrast = await options.evaluate(() => {
      const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const luminance = (hex: string) => {
        const rgb = hex.slice(1).match(/.{2}/gu)!.map(channel => {
          const value = parseInt(channel, 16) / 255;
          return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        });
        return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
      };
      const background = luminance(token('--surface'));
      return ['--text', '--muted', '--subtle', '--accent', '--danger', '--warning'].map(name => {
        const foreground = luminance(token(name));
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
    });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await expect(options.getByRole('button', { name: 'Sessions', exact: true })).toHaveCSS('transition-duration', '0s');

    await site.bringToFront();
    const opened = context.waitForEvent('page');
    await options.evaluate(url => chrome.tabs.create({ url, active: false }), `chrome-extension://${extensionId}/popup.html`);
    const popup = await opened;
    await popup.setViewportSize({ width: 400, height: 600 });
    await expect(popup.getByRole('heading', { name: 'Automation likely' })).toBeVisible();
    await noOverflow(popup);
    const current = await popup.getByRole('region', { name: 'Current tab assessment' }).boundingBox();
    const controls = await popup.getByRole('region', { name: 'Tab controls' }).boundingBox();
    const browser = await popup.getByRole('region', { name: 'Browser-wide summary' }).boundingBox();
    expect(current!.y).toBeLessThan(controls!.y);
    expect(controls!.y).toBeLessThan(browser!.y);
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(600);
    await popup.screenshot({ path: testInfo.outputPath('popup-dark.png') });

    await send(options, { type: 'QUARANTINE_TAB', tabId });
    await expect(site.getByRole('heading', { name: 'This tab is quarantined' })).toBeVisible();
    for (const width of [1440, 390]) {
      await site.setViewportSize({ width, height: 1000 });
      await noOverflow(site);
      const release = site.getByRole('button', { name: 'Release this tab' });
      await expect(release).toBeInViewport();
      await site.screenshot({ path: testInfo.outputPath(`containment-${width}.png`), fullPage: true });
    }
  } finally { await context.close(); }
});

test('native toolbar popup keeps its 400px width and scrolls vertically on first open and reopen', async ({}, testInfo) => {
  const { context, options, extensionId } = await openExtension();
  try {
    const browser = await context.browser()!.newBrowserCDPSession();
    const inspectedTargets = new Set<string>();
    for (let opening = 0; opening < 2; opening++) {
      await options.bringToFront();
      await options.evaluate(() => chrome.action.openPopup());
      const { targetInfos } = await browser.send('Target.getTargets');
      const target = targetInfos.find(item => item.url === `chrome-extension://${extensionId}/popup.html`);
      expect(target, 'Chrome must open the actual action popup, not a substitute tab').toBeDefined();
      expect(inspectedTargets.has(target!.targetId), 'Reopen must inspect a new native popup target').toBe(false);
      inspectedTargets.add(target!.targetId);
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: target!.targetId, flatten: false });
      let sequence = 0;
      // Action popups are not Playwright Pages. Inspect the native target through
      // CDP without device emulation, viewport overrides or production permission changes.
      const command = <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> => new Promise((resolve, reject) => {
        const id = ++sequence;
        const cleanup = () => { clearTimeout(timer); browser.off('Target.receivedMessageFromTarget', receive); };
        const receive = (event: { sessionId: string; message: string }) => {
          if (event.sessionId !== sessionId) return;
          const response = JSON.parse(event.message) as { id?: number; result: T; error?: { message: string } };
          if (response.id !== id) return;
          cleanup();
          if (response.error) reject(new Error(response.error.message));
          else resolve(response.result);
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Native popup inspection timed out')); }, 5000);
        browser.on('Target.receivedMessageFromTarget', receive);
        void browser.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => { cleanup(); reject(error); });
      });
      const evaluate = async <T,>(expression: string) => (await command<{ result: { value: T } }>('Runtime.evaluate', { expression, returnByValue: true })).result.value;
      await expect.poll(() => evaluate<boolean>('Boolean(document.querySelector(".popup-footer"))')).toBe(true);
      // Native popup geometry/paint can settle after React has mounted, especially
      // on reopen. Wait for real frames, not a forced viewport or an arbitrary sleep.
      await expect.poll(() => evaluate<boolean>('innerHeight >= 480')).toBe(true);
      await command('Runtime.evaluate', { expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))', awaitPromise: true });
      const screenshot = await command<{ data: string }>('Page.captureScreenshot', { captureBeyondViewport: false });
      await writeFile(testInfo.outputPath(`native-popup-${opening}.png`), Buffer.from(screenshot.data, 'base64'));
      const size = await evaluate<{ viewport: number; shell: number; height: number; horizontalOverflow: boolean; canScroll: boolean; headerFits: boolean }>(`(() => {
        const shell = document.querySelector('.popup-shell').getBoundingClientRect();
        const brand = document.querySelector('.popup-header .brand').getBoundingClientRect();
        const settings = document.querySelector('.popup-header button').getBoundingClientRect();
        return { viewport: innerWidth, shell: shell.width, height: innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          canScroll: document.documentElement.scrollHeight > innerHeight,
          headerFits: settings.left > brand.right && settings.right <= innerWidth };
      })()`);
      expect(size.viewport).toBe(400);
      expect(size.shell).toBe(400);
      expect(size.height).toBeGreaterThanOrEqual(480);
      expect(size.height).toBeLessThanOrEqual(600);
      expect(size.horizontalOverflow).toBe(false);
      expect(size.canScroll).toBe(true);
      expect(size.headerFits).toBe(true);
      const scrolled = await evaluate<boolean>(`(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return window.scrollY > 0 && document.querySelector('.popup-footer').getBoundingClientRect().bottom <= innerHeight + 1;
      })()`);
      expect(scrolled).toBe(true);
      await browser.send('Target.closeTarget', { targetId: target!.targetId });
      await expect.poll(async () => (await browser.send('Target.getTargets')).targetInfos.some(item => item.targetId === target!.targetId)).toBe(false);
    }
  } finally { await context.close(); }
});
