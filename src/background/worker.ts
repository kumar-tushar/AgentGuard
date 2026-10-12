import type { AgentGuardConfig, AuditEventType, Capabilities, Dashboard, EffectiveConfig, PolicyAction, Request, TabAgentStatus } from '../shared/contracts';
import { AuditStore } from '../audit/store';
import { DEFAULT_CONFIG, resolveConfig } from '../enterprise/config';
import { domainFromUrl } from '../shared/domains';
import { capabilities, canObserve, captureDebuggerSnapshot, observe, readTab, stopBehavior, updateBadge, within, type DebuggerSnapshot } from './browser';
import { Containment, chromeContainmentPort } from './containment';
import { isTrustedUi, parseRequest } from './messages';
import { TabMonitor } from './monitor';
import { SessionStore } from './session';
import { localPreferencesForSave } from './settings';
import { restoreQuarantinedTab } from './recovery';
import { parseSensorSignal, sensorSender, SensorGate } from './sensor-messages';
import { AgentSessionStore } from './agent-sessions';
import { toSessionObservation } from './session-observation';
import { hasAutomation } from '../shared/intelligence';
import { DebuggerIntelligenceStore } from './debugger-intelligence';
import { TabAlerts, parseAlertActivation } from './tab-alerts';
import { renderTabAlert } from '../content/tab-alert';

const CONFIG_KEY = 'agentguard.config.v1';
const SESSION_KEY = 'agentguard.session.v1';
const AGENT_SESSIONS_KEY = 'agentguard.agent-sessions.v1';
const AGENT_HISTORY_KEY = 'agentguard.agent-history.v1';
const DEBUGGER_HISTORY_KEY = 'agentguard.debugger-history.v1';
const ALERT_MUTES_KEY = 'agentguard.alert-mutes.v1';
const ALARM = 'agentguard.refresh.v1';
let config: EffectiveConfig = { values: DEFAULT_CONFIG, managedKeys: [], errors: [] };
const healthErrors = new Set<string>();
let configQueue: Promise<void> = Promise.resolve();
let refreshQueue: Promise<void> | undefined;
let lastCapabilities: Capabilities = { debugger: false, networkBlocking: false, origins: [] };
const sensorGate = new SensorGate();
const scheduled = new Set<number>();
let inventoryScheduled = false;
let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
let eventRefresh: Promise<void> | undefined;
let sessionsReady = false;
let alertsReady = false;
const alerts = new TabAlerts({
  async read() { return (await chrome.storage.session.get(ALERT_MUTES_KEY))[ALERT_MUTES_KEY]; },
  write: data => chrome.storage.session.set({ [ALERT_MUTES_KEY]: data }),
  assessments: () => config.values.monitoringEnabled ? monitor.snapshot() : [],
  async recipients() {
    return (await chrome.tabs.query({ active: true })).flatMap(tab => tab.id !== undefined && canObserve(tab.url) ? [tab.id] : []);
  },
  async document(tabId) {
    const frame = await within(chrome.webNavigation.getFrame({ tabId, frameId: 0 }));
    return frame?.documentLifecycle === 'active' && canObserve(frame.url) ? frame.documentId : null;
  },
  async present(tabId, documentId, input) {
    await within(chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, world: 'ISOLATED', func: renderTabAlert, args: [input] }));
  },
  async activate(tabId) {
    const tab = await within(chrome.tabs.update(tabId, { active: true }));
    if (!tab || tab.id !== tabId) throw new Error('Tab activation unavailable');
    await within(chrome.windows.update(tab.windowId, { focused: true }));
  },
});
const state = new SessionStore({
  async read() { return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY]; },
  write: (data) => chrome.storage.session.set({ [SESSION_KEY]: data }),
});
const debuggerIntelligence = new DebuggerIntelligenceStore({
  async read() { return (await chrome.storage.session.get(DEBUGGER_HISTORY_KEY))[DEBUGGER_HISTORY_KEY]; },
  write: data => chrome.storage.session.set({ [DEBUGGER_HISTORY_KEY]: data }),
});
const sessions = new AgentSessionStore({
  async readSession() { return (await chrome.storage.session.get(AGENT_SESSIONS_KEY))[AGENT_SESSIONS_KEY]; },
  writeSession: data => chrome.storage.session.set({ [AGENT_SESSIONS_KEY]: data }),
  async readHistory() { return (await chrome.storage.local.get(AGENT_HISTORY_KEY))[AGENT_HISTORY_KEY]; },
  writeHistory: data => chrome.storage.local.set({ [AGENT_HISTORY_KEY]: data }),
}, { limits: () => ({ retentionDays: config.values.sessionRetentionDays, maxHistorySessions: config.values.maxHistorySessions }) });
const audit = new AuditStore({
  async get(key) { return (await chrome.storage.local.get(key))[key]; },
  async set(key, value) { await chrome.storage.local.set({ [key]: value }); },
}, () => config.values);
const containment = new Containment(state, chromeContainmentPort());
const isContainmentPage = (url?: string) => url?.split(/[?#]/, 1)[0] === chrome.runtime.getURL('blocked.html');

function report(error: string): void { healthErrors.add(error); }
function safely(work: Promise<unknown>, error: string): void {
  void work.catch(() => report(error));
}
async function refreshAlerts(): Promise<void> {
  if (!alertsReady) return;
  try { await alerts.refresh(); }
  catch { report('An in-page alert could not be displayed. Check AgentGuard from the extensions menu.'); }
}

async function log(eventType: AuditEventType, tab?: Pick<TabAgentStatus, 'tabId' | 'domain' | 'confidence'>, policyAction: PolicyAction = 'none'): Promise<void> {
  try { await audit.append({
    id: crypto.randomUUID(), timestamp: Date.now(), tabId: tab?.tabId ?? null,
    domain: tab?.domain ?? null, eventType, detectedAgent: null,
    confidence: tab?.confidence ?? 0, policyAction, detail: '',
  }); } catch { report('Audit persistence failed. Some events may be missing from this browser.'); }
}

const monitor = new TabMonitor(state, () => config.values, {
  getTab: readTab, canObserve, isContainmentPage, observe,
  async onAssessment(tab, previous, isCurrent) {
    if (sessionsReady && await isCurrent()) {
      try {
        if (!config.values.monitoringEnabled) await sessions.endTab(tab.tabId, 'monitoring_disabled', tab.assessedAt);
        else await sessions.observe(toSessionObservation(tab));
      } catch { report('Session history could not be updated. Current tab detection remains available.'); }
    }
    const changed = !previous || previous.status !== tab.status || previous.confidence !== tab.confidence || previous.domain !== tab.domain ||
      JSON.stringify(previous.evidence.map((item) => item.detector)) !== JSON.stringify(tab.evidence.map((item) => item.detector));
    if (changed && (tab.evidence.length || previous?.evidence.length)) await log('detection_changed', tab, tab.policy.action);
    const coverageChanged = previous && JSON.stringify(previous.coverage.map((item) => item.availability)) !== JSON.stringify(tab.coverage.map((item) => item.availability));
    if (coverageChanged) await log('coverage_changed', tab);
    if (tab.policy.action !== 'none' && (changed || previous?.policy.action !== tab.policy.action)) await log('policy_triggered', tab, tab.policy.action);
    if (tab.policy.action === 'quarantine' && !state.quarantines.has(tab.tabId) && config.errors.length === 0 && await isCurrent()) {
      try {
        await containment.quarantine(tab.tabId, tab.domain, tab.policy.reason, isCurrent);
        await log('quarantined', tab, 'quarantine');
      } catch {
        report('A policy quarantine failed. Review the tab and use Close tab if needed.');
        await log('enforcement_failed', tab, 'quarantine');
      }
    }
    if (await isCurrent()) await updateBadge(tab.tabId, tab.status, state.quarantines.has(tab.tabId), tab.policy.action);
  },
});

async function restoreContainment(tabId: number): Promise<void> {
  const record = state.quarantines.get(tabId);
  if (!record) return;
  try {
    // Wait for the completed document/context before deciding whether it escaped.
    if ((await chrome.tabs.get(tabId)).status === 'loading') return;
    const restored = await restoreQuarantinedTab(record, {
      getUrl: async (id) => (await readTab(id)).url,
      isContainmentPage,
      hasRecord: (id) => state.quarantines.has(id),
      async replace(current, isCurrent) { await containment.quarantine(current.tabId, current.domain, current.reason, isCurrent); },
    });
    if (restored) await log('quarantined', { tabId, domain: record.domain, confidence: 0 }, 'quarantine');
  } catch {
    report('A quarantined tab left the containment page and could not be restored. Use Close tab if needed.');
    await log('enforcement_failed', { tabId, domain: record.domain, confidence: 0 }, 'quarantine');
  }
}

async function scanTab(tabId: number, snapshot?: DebuggerSnapshot): Promise<TabAgentStatus> {
  await restoreContainment(tabId);
  return monitor.scan(tabId, snapshot);
}

/** Event bursts are batched; one target snapshot serves all queued tabs with bounded concurrency. */
function scheduleTab(tabId?: number): void {
  if (tabId !== undefined) {
    if (scheduled.size >= 1000 && !scheduled.has(tabId)) { report('Monitoring capacity exceeded; some tabs have reduced coverage.'); return; }
    scheduled.add(tabId);
  } else inventoryScheduled = true;
  if (scheduleTimer !== undefined || eventRefresh) return;
  scheduleTimer = setTimeout(() => {
    scheduleTimer = undefined;
    eventRefresh = ready.then(async () => {
      const ids = [...scheduled];
      scheduled.clear();
      inventoryScheduled = false;
      // The batch can contain newly created targets absent from the prior snapshot.
      const snapshot = await captureDebuggerSnapshot(true);
      lastCapabilities = await capabilities(snapshot);
      await recordDebuggerSnapshot(snapshot, await chrome.tabs.query({}));
      for (let start = 0; start < ids.length; start += 4) {
        await Promise.all(ids.slice(start, start + 4).map(id => scanTab(id, snapshot).catch(() => report('An event-driven observation failed.'))));
      }
      await refreshAlerts();
    }).finally(() => {
      eventRefresh = undefined;
      const next = scheduled.values().next().value;
      if (next !== undefined) scheduleTab(next);
      else if (inventoryScheduled) scheduleTab();
    });
    safely(eventRefresh, 'Automatic monitoring needs attention.');
  }, 200);
}

async function loadConfig(): Promise<void> {
  const local = await chrome.storage.local.get(CONFIG_KEY);
  let managed: unknown;
  try { managed = await chrome.storage.managed.get(null); }
  catch { managed = undefined; report('Managed policy could not be read. Automatic enforcement is suspended.'); }
  const next = resolveConfig(local[CONFIG_KEY], managed);
  if (managed === undefined) {
    next.errors.push('Managed policy could not be read.');
    next.values = { ...next.values, monitoringEnabled: false, policyMode: 'monitor' };
  }
  config = next;
}

async function recordDebuggerSnapshot(snapshot: DebuggerSnapshot, tabs: readonly chrome.tabs.Tab[]): Promise<void> {
  const domains = new Map(tabs.flatMap(tab => tab.id === undefined ? [] : [[tab.id, domainFromUrl(tab.url)] as const]));
  const observed = config.values.monitoringEnabled ? snapshot : { ...snapshot, available: false, targets: [] };
  try { await debuggerIntelligence.reconcile(observed, domains); }
  catch { report('Debugger observation history could not be saved. Detection coverage is reported independently.'); }
}

async function setup(): Promise<void> {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.managed.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
  await loadConfig();
  const tabs = await chrome.tabs.query({});
  const ids = new Set(tabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id]));
  await state.load(ids);
  try { await alerts.load(ids); alertsReady = true; }
  catch { report('Alert dismissal preferences could not be read. In-page alerts are unavailable until storage recovers.'); }
  try { await debuggerIntelligence.load(); }
  catch { report('Debugger observation history could not be restored.'); }
  try { await sessions.load(ids); sessionsReady = true; }
  catch { report('Session history could not be restored. Current tab detection remains available.'); }
  try { await containment.reconcile(ids); }
  catch { report('Some quarantine rules could not be restored. Review or release affected tabs; monitoring remains available.'); }
  for (const tabId of state.quarantines.keys()) await restoreContainment(tabId);
  await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

// Start once per worker lifetime. Event listeners below register without awaiting it.
const ready = setup();
safely(ready, 'AgentGuard could not initialize storage or monitoring. Reload the extension after reviewing permissions.');

async function refreshAll(): Promise<void> {
  await ready;
  if (refreshQueue) return refreshQueue;
  refreshQueue = (async () => {
    const allTabs = await chrome.tabs.query({});
    if (!alertsReady) {
      try { await alerts.load(new Set(allTabs.flatMap(tab => tab.id === undefined ? [] : [tab.id]))); alertsReady = true; }
      catch { /* Preserve detection while alert preferences are unavailable. */ }
    }
    if (allTabs.length > 500) report('This browser exceeds the 500-tab assessment retention limit. Older observations may be evicted.');
    const snapshot = await captureDebuggerSnapshot(true);
    lastCapabilities = await capabilities(snapshot);
    await recordDebuggerSnapshot(snapshot, allTabs);
    const tabs = allTabs;
    for (let start = 0; start < tabs.length; start += 4) {
      await Promise.all(tabs.slice(start, start + 4).map(async (tab) => {
        if (tab.id === undefined) return;
        try {
          if (canObserve(tab.url)) {
            // Static scripts do not backfill documents already open at installation/reload.
            try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', files: ['sensor.js'] }); }
            catch { /* Runtime observation independently reports the access gap. */ }
          }
          await scanTab(tab.id, snapshot);
        }
        catch { report('A tab refresh failed; its previous evidence may expire.'); }
      }));
    }
    await refreshAlerts();
    await audit.list();
    if (sessionsReady) await sessions.expire(Date.now());
  })();
  try { await refreshQueue; } finally { refreshQueue = undefined; }
}

async function saveConfig(requested: AgentGuardConfig): Promise<EffectiveConfig> {
  const operation = configQueue.then(async () => {
    await loadConfig();
    if (config.errors.some((error) => error.startsWith('Managed'))) throw new Error('Managed configuration needs administrator attention.');
    const stored = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
    const clean = localPreferencesForSave(requested, stored, config);
    await chrome.storage.local.set({ [CONFIG_KEY]: clean });
    await loadConfig();
    await log('settings_changed');
    if (!config.values.behaviorEnabled || !config.values.monitoringEnabled) {
      await Promise.all((await chrome.tabs.query({})).map(async (tab) => {
        if (tab.id !== undefined && canObserve(tab.url)) {
          try { await stopBehavior(tab.id); } catch { /* A revoked grant prevents teardown; collector self-expires. */ }
        }
      }));
    }
    for (const tabId of [...state.tabs.keys()]) await monitor.invalidate(tabId);
    safely(refreshAll(), 'Could not refresh tabs after changing configuration.');
  });
  configQueue = operation.catch(() => undefined);
  await operation;
  return config;
}

async function dashboard(): Promise<Dashboard> {
  await monitor.expire();
  const tabs = monitor.snapshot();
  // Session snapshots are historical observations, not a substitute for current coverage.
  const currentSessions = sessionsReady ? sessions.snapshot(Date.now()).filter(session =>
    tabs.some(tab => tab.tabId === session.tabId && tab.assessedAt === session.lastObservedAt && hasAutomation(tab.status))) : [];
  return { config, capabilities: lastCapabilities, tabs, sessions: currentSessions, debuggerIntelligence: debuggerIntelligence.snapshot(), audit: await audit.list(), quarantines: [...state.quarantines.values()], healthErrors: [...healthErrors] };
}

async function handle(request: Request): Promise<unknown> {
  try { await ready; }
  catch {
    if (request.type === 'GET_DASHBOARD') return {
      config, capabilities: { debugger: false, networkBlocking: false, origins: [] },
      tabs: [], sessions: [], audit: [], quarantines: [...state.quarantines.values()], healthErrors: [...healthErrors],
      debuggerIntelligence: { coverageAvailable: false, lastCapturedAt: null, targets: [] },
    } satisfies Dashboard;
    throw new Error('AgentGuard initialization requires attention.');
  }
  switch (request.type) {
    case 'GET_DASHBOARD': return dashboard();
    case 'SAVE_CONFIG': return saveConfig(request.config);
    case 'EXPORT_AUDIT': return audit.export();
    case 'CLEAR_AUDIT': await audit.clear(); return null;
    case 'GET_SESSION_HISTORY':
      if (!sessionsReady) throw new Error('Session history unavailable.');
      await sessions.expire(Date.now());
      return sessions.history();
    case 'EXPORT_SESSIONS': {
      if (!sessionsReady) throw new Error('Session history unavailable.');
      await sessions.expire(Date.now());
      const current = await dashboard();
      return { schemaVersion: 1, exportedAt: Date.now(), source: 'agentguard-extension', sessions: current.sessions, history: sessions.history() };
    }
    case 'CLEAR_SESSION_HISTORY':
      if (!sessionsReady) throw new Error('Session history unavailable.');
      await sessions.clearHistory();
      return null;
    case 'QUARANTINE_TAB': {
      const tab = await chrome.tabs.get(request.tabId);
      if (!canObserve(tab.url)) throw new Error('Open AgentGuard on an authorized HTTP(S) tab before quarantining it.');
      const domain = domainFromUrl(tab.url);
      try {
        const record = await containment.quarantine(request.tabId, domain, 'Employee requested emergency quarantine.');
        await log('quarantined', { tabId: request.tabId, domain, confidence: state.tabs.get(request.tabId)?.confidence ?? 0 }, 'quarantine');
        await updateBadge(request.tabId, 'UNMONITORED', true);
        return record;
      } catch (error) {
        await log('enforcement_failed', { tabId: request.tabId, domain, confidence: 0 }, 'quarantine');
        throw error;
      }
    }
    case 'RELEASE_TAB': {
      const record = state.quarantines.get(request.tabId);
      try { await containment.release(request.tabId); }
      catch {
        report('A release was incomplete. The network rule or saved state may need cleanup; retry Release tab.');
        await log('enforcement_failed', { tabId: request.tabId, domain: record?.domain ?? null, confidence: 0 });
        throw new Error('Release was incomplete.');
      }
      await monitor.invalidate(request.tabId);
      await log('released', { tabId: request.tabId, domain: record?.domain ?? null, confidence: 0 });
      await updateBadge(request.tabId, 'UNMONITORED');
      return null;
    }
    case 'CLOSE_TAB': {
      const tab = state.tabs.get(request.tabId);
      try { await containment.close(request.tabId); }
      catch {
        const stillOpen = (await chrome.tabs.query({})).some((item) => item.id === request.tabId);
        if (!stillOpen) await log('tab_closed', tab ?? { tabId: request.tabId, domain: null, confidence: 0 });
        await log('enforcement_failed', tab ?? { tabId: request.tabId, domain: null, confidence: 0 });
        report(stillOpen ? 'A tab could not be closed. Try again from Chrome.' : 'The tab was closed, but temporary rule cleanup needs attention.');
        throw new Error('Close or cleanup was incomplete.');
      }
      await log('tab_closed', tab ?? { tabId: request.tabId, domain: null, confidence: 0 });
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
  if (typeof input === 'object' && input !== null && Reflect.get(input, 'type') === 'ACTIVATE_TAB_ALERT') {
    const source = sensorSender(sender, chrome.runtime.id);
    const token = parseAlertActivation(input);
    if (!source || !token) { respond({ ok: false }); return false; }
    void ready.then(async () => {
      if (!alertsReady) return { ok: false };
      const mutedUntil = await alerts.activate(source.tabId, source.documentId, token);
      if (mutedUntil !== null) safely(refreshAlerts(), 'Alert refresh after tab activation failed.');
      return mutedUntil === null ? { ok: false } : { ok: true, mutedUntil };
    }).then(respond, () => respond({ ok: false }));
    return true;
  }
  if (typeof input === 'object' && input !== null && Reflect.get(input, 'type') === 'SENSOR_SIGNAL') {
    const source = sensorSender(sender, chrome.runtime.id);
    const signal = parseSensorSignal(input, Date.now());
    if (!source || !signal) { respond({ ok: false }); return false; }
    void ready.then(async () => {
      const frame = await chrome.webNavigation.getFrame({ tabId: source.tabId, frameId: 0 });
      if (frame?.documentId !== source.documentId || frame.documentLifecycle !== 'active') return { ok: false };
      if (sensorGate.accept(source.tabId, source.documentId, signal, Date.now())) scheduleTab(source.tabId);
      return { ok: true, monitoringEnabled: config.values.monitoringEnabled, behaviorEnabled: config.values.behaviorEnabled };
    }).then(respond, () => respond({ ok: false }));
    return true;
  }
  if (!isTrustedUi(sender, chrome.runtime.id)) { respond({ ok: false, error: 'Only AgentGuard UI pages may send commands.' }); return false; }
  let request: Request;
  try { request = parseRequest(input); }
  catch { respond({ ok: false, error: 'Invalid AgentGuard request.' }); return false; }
  void handle(request).then((data) => respond({ ok: true, data }), () => {
    // Never forward raw Chrome errors: they may contain the full tab URL.
    respond({ ok: false, error: 'The operation could not complete. Check permissions, managed settings and whether the tab is still open.' });
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  // Invalidate synchronously, including while initialization/other async work is pending.
  if (change.status === 'loading' || change.url !== undefined) {
    alerts.invalidate(tabId);
    void monitor.invalidate(tabId, false, false);
    safely(ready.then(refreshAlerts), 'An outdated in-page alert could not be removed; it will expire automatically.');
    safely(ready.then(async () => {
      await monitor.invalidate(tabId);
      await updateBadge(tabId, 'UNMONITORED', state.quarantines.has(tabId));
    }), 'Could not invalidate a previous tab observation.');
  }
  if (change.status === 'complete') scheduleTab(tabId);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  scheduleTab(tabId);
  safely(ready.then(refreshAlerts), 'Tab notification reconciliation failed.');
});
chrome.tabs.onCreated.addListener(tab => { if (tab.id !== undefined) scheduleTab(tab.id); });
chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  safely(chrome.tabs.query({ active: true, windowId }).then(tabs => {
    for (const tab of tabs) if (tab.id !== undefined) scheduleTab(tab.id);
  }), 'Window focus reconciliation failed.');
});
chrome.webNavigation.onHistoryStateUpdated.addListener(event => { if (event.frameId === 0) scheduleTab(event.tabId); });
chrome.webNavigation.onReferenceFragmentUpdated.addListener(event => { if (event.frameId === 0) scheduleTab(event.tabId); });
chrome.tabs.onRemoved.addListener((tabId) => {
  alerts.invalidate(tabId);
  safely(ready.then(() => alerts.forget(tabId)), 'A closed tab alert preference could not be cleared.');
  sensorGate.forget(tabId);
  scheduled.delete(tabId);
  scheduleTab(); // Reconcile disappearance without trying to observe the closed tab.
  void monitor.invalidate(tabId, true, false);
  safely(ready.then(async () => {
    if (sessionsReady) {
      try { await sessions.endTab(tabId, 'closed', Date.now()); }
      catch { report('A closed tab session could not be saved to history.'); }
    }
    await containment.release(tabId);
    await monitor.invalidate(tabId, true);
    await refreshAlerts();
  }), 'Could not clean up a closed tab.');
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  alerts.invalidate(removed);
  safely(ready.then(() => alerts.forget(removed)), 'A replaced tab alert preference could not be cleared.');
  void monitor.invalidate(removed, true, false);
  safely(ready.then(async () => {
    if (sessionsReady) {
      try { await sessions.endTab(removed, 'closed', Date.now()); }
      catch { report('A replaced tab session could not be saved to history.'); }
    }
    await monitor.invalidate(removed, true); await containment.release(removed); scheduleTab(added);
  }), 'Could not assess a replaced tab.');
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) safely(refreshAll(), 'Scheduled monitoring failed.'); });
chrome.runtime.onInstalled.addListener(() => safely(refreshAll(), 'Initial monitoring failed.'));
chrome.runtime.onStartup.addListener(() => safely(refreshAll(), 'Startup monitoring failed.'));
const permissionChanged = () => safely(ready.then(async () => {
  const ids = new Set((await chrome.tabs.query({})).flatMap((tab) => tab.id === undefined ? [] : [tab.id]));
  await containment.reconcile(ids);
  for (const id of [...state.tabs.keys()]) await monitor.invalidate(id);
  await refreshAll();
}), 'Permission changes could not be fully applied.');
chrome.permissions.onAdded.addListener(permissionChanged);
chrome.permissions.onRemoved.addListener(permissionChanged);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed' || (area === 'local' && changes[CONFIG_KEY])) {
    safely(ready.then(async () => {
      await loadConfig();
      for (const id of [...state.tabs.keys()]) await monitor.invalidate(id);
      await refreshAll();
    }), 'Configuration could not be refreshed.');
  }
});

// Each worker activation reconciles already-open tabs without any UI request.
safely(ready.then(() => refreshAll()), 'Startup monitoring failed.');
