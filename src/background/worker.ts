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
import { DocumentActivity } from './activity';
import { StatisticsStore } from './statistics';
import { summarizeSession } from '../session/reports';
import { EmergencyController } from './emergency';
import { ControlStore } from '../delegation/store';
import { DelegationEgress } from './egress';
import { installApiBoundary, installInteractionBoundary, grantBoundaryOnce } from '../content/boundary';
import { UpdateController } from './updates';
import { TrafficObserver } from './traffic';
import { DownloadMonitor } from './downloads';
import { DesktopAlerts } from './notifications';
import { RemoteServices } from '../integrations/client';
import { fingerprintDefinition } from '../shared/fingerprints';
import type { Framework } from '../shared/intelligence';

const CONFIG_KEY = 'agentguard.config.v1';
const SESSION_KEY = 'agentguard.session.v1';
const AGENT_SESSIONS_KEY = 'agentguard.agent-sessions.v1';
const AGENT_HISTORY_KEY = 'agentguard.agent-history.v1';
const DEBUGGER_HISTORY_KEY = 'agentguard.debugger-history.v1';
const ALERT_MUTES_KEY = 'agentguard.alert-mutes.v1';
const ALARM = 'agentguard.refresh.v1';
const CONTROL_ALARM = 'agentguard.control-expiry.v1';
const OBSERVATION_ALARM = 'agentguard.observation-expiry.v1';
let config: EffectiveConfig = { values: DEFAULT_CONFIG, managedKeys: [], errors: [] };
const healthErrors = new Set<string>();
let configQueue: Promise<void> = Promise.resolve();
let refreshQueue: Promise<void> | undefined;
let lastCapabilities: Capabilities = { debugger: false, networkBlocking: false, origins: [] };
const sensorGate = new SensorGate();
const activity = new DocumentActivity();
const statistics = new StatisticsStore({
  async read() { return (await chrome.storage.local.get('agentguard.statistics.v1'))['agentguard.statistics.v1']; },
  write: data => chrome.storage.local.set({ 'agentguard.statistics.v1': data }),
});
const scheduled = new Set<number>();
const discardedScans = new Map<number, number>();
let inventoryScheduled = false;
let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
let eventRefresh: Promise<void> | undefined;
let sessionsReady = false;
let alertsReady = false;
let controlsReady = false;
let statisticsReady = false;
const boundaryTabs = new Set<number>();
const controls = new ControlStore({
  async read() { return (await chrome.storage.session.get('agentguard.controls.v1'))['agentguard.controls.v1']; },
  write: value => chrome.storage.session.set({ 'agentguard.controls.v1': value }),
}, Date.now, () => config.values.maximumGrantMinutes ?? 60);
const egress = new DelegationEgress();
const remote = new RemoteServices(() => config.errors.length ? DEFAULT_CONFIG : config.values);
let ownershipWrites: Promise<void> = Promise.resolve();
const traffic = new TrafficObserver({
  attach: id => chrome.debugger.attach({ tabId: id }, '1.3'),
  command: (id, method) => chrome.debugger.sendCommand({ tabId: id }, method, method === 'Network.enable' ? { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 } : {}),
  async detach(id) {
    try { await chrome.debugger.detach({ tabId: id }); }
    catch (error) {
      // Chrome may have already ended our session during worker termination.
      // Only an explicit inspectable unattached target confirms that cleanup.
      const target = (await chrome.debugger.getTargets()).find(target => target.tabId === id);
      if (!target || target.attached !== false) throw error;
    }
  },
  writeOwners(ids) {
    const pending = ownershipWrites.then(() => chrome.storage.session.set({ 'agentguard.observation-owners.v1': ids }));
    ownershipWrites = pending.catch(() => undefined); return pending;
  },
});
const downloads = new DownloadMonitor({
  policy: () => config.errors.length || !config.values.monitoringEnabled ? 'off' : config.values.downloadPolicy ?? 'off',
  permitted: () => chrome.permissions.contains({ permissions: ['downloads'] }),
  cancel: id => chrome.downloads.cancel(id),
});
const desktopAlerts = new DesktopAlerts({
  enabled: () => config.values.monitoringEnabled && config.values.desktopNotifications === true,
  permitted: () => chrome.permissions.contains({ permissions: ['notifications'] }),
  async show(id) { await chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon-alert-128.png', title: 'AgentGuard · Automation signals observed', message: 'Review the tab and detection evidence. Controller identity is unverified. Click to switch to the affected tab.' }); },
  async clear(id) { await chrome.notifications?.clear(id); },
  assessment: id => state.tabs.get(id),
  async activate(id) { const tab = await chrome.tabs.update(id, { active: true }); if (!tab) throw new Error('Tab unavailable'); await chrome.windows.update(tab.windowId, { focused: true }); },
});
const updates = new UpdateController({
  async read() { return (await chrome.storage.session.get('agentguard.update.v1'))['agentguard.update.v1']; },
  write: value => chrome.storage.session.set({ 'agentguard.update.v1': value }),
  busy: () => !controlsReady || emergency.snapshot().active || controls.snapshot().grants.length > 0 || state.quarantines.size > 0,
  reload() { setTimeout(() => chrome.runtime.reload(), 100); },
});
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
const emergency = new EmergencyController({
  async read() { return (await chrome.storage.local.get('agentguard.emergency.v1'))['agentguard.emergency.v1']; },
  write: value => chrome.storage.local.set({ 'agentguard.emergency.v1': value }),
  assessments: () => monitor.snapshot(),
  async revokeGrants() { activity.clear(); await controls.revokeAll(); await synchronizeControls(); },
  async act(tab, action) {
    const isCurrent = async () => state.tabs.get(tab.tabId)?.assessedAt === tab.assessedAt &&
      tab.expiresAt > Date.now() && domainFromUrl((await readTab(tab.tabId)).url) === tab.domain;
    if (!await isCurrent()) throw new Error('Emergency observation changed');
    try {
      if (action === 'close') {
        await within(containment.close(tab.tabId));
        await log('tab_closed', tab);
      } else {
        await within(containment.quarantine(tab.tabId, tab.domain, 'User activated emergency containment.', isCurrent));
        await log('quarantined', tab, 'quarantine');
        await statistics.containment();
      }
    } catch (cause) { await log('enforcement_failed', tab); throw cause; }
  },
});
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
  getTab: readTab, canObserve, isContainmentPage,
  observe: (id, behavior, now, snapshot) => observe(id, behavior, now, snapshot, config.values.stackSignalsEnabled === true),
  async onAssessment(tab, previous, isCurrent) {
    if (await isCurrent()) {
      try { await debuggerIntelligence.associateDomain(tab.tabId, tab.domain); }
      catch { report('Debugger observation history could not be saved. Detection coverage is reported independently.'); }
    }
    if (sessionsReady && await isCurrent()) {
      try {
        if (!config.values.monitoringEnabled) await sessions.endTab(tab.tabId, 'monitoring_disabled', tab.assessedAt);
        else {
          const frame = config.values.behaviorEnabled && hasAutomation(tab.status)
            ? await chrome.webNavigation.getFrame({ tabId: tab.tabId, frameId: 0 }) : null;
          if (!await isCurrent()) return;
          // Consume before persistence: failed writes may lose this bounded sample,
          // but must never replay it and inflate session counters on retry.
          const delta = frame?.documentLifecycle === 'active' && frame.documentId
            ? activity.take(tab.tabId, frame.documentId, tab.assessedAt) : {};
          const previousSessionId = sessions.snapshot(Date.now()).find(session => session.tabId === tab.tabId)?.id;
          const session = await sessions.observe(toSessionObservation(tab, delta));
          if (session && statisticsReady) await statistics.record(session, session.id !== previousSessionId);
        }
      } catch { report('Session history could not be updated. Current tab detection remains available.'); }
    }
    const changed = !previous || previous.status !== tab.status || previous.confidence !== tab.confidence || previous.domain !== tab.domain ||
      JSON.stringify(previous.evidence.map((item) => item.detector)) !== JSON.stringify(tab.evidence.map((item) => item.detector));
    if (changed && (tab.evidence.length || previous?.evidence.length)) await log('detection_changed', tab, tab.policy.action);
    if (changed && await isCurrent()) {
      try { await desktopAlerts.consider(tab); } catch { report('Optional desktop notification could not be shown. In-page alerts remain independent.'); }
    }
    const coverageChanged = previous && JSON.stringify(previous.coverage.map((item) => item.availability)) !== JSON.stringify(tab.coverage.map((item) => item.availability));
    if (coverageChanged) await log('coverage_changed', tab);
    if (tab.policy.action !== 'none' && (changed || previous?.policy.action !== tab.policy.action)) await log('policy_triggered', tab, tab.policy.action);
    if (controlsReady && await isCurrent()) {
      try { await applyBoundary(tab.tabId); } catch { report('A page-level delegation boundary could not be installed. Native driver actions remain outside this boundary.'); }
    }
    if (emergency.snapshot().active && hasAutomation(tab.status) && !state.quarantines.has(tab.tabId) && await isCurrent()) {
      await emergency.enforce(tab);
    }
    if (tab.policy.action === 'quarantine' && !state.quarantines.has(tab.tabId) && config.errors.length === 0 && await isCurrent()) {
      try {
        await containment.quarantine(tab.tabId, tab.domain, tab.policy.reason, isCurrent);
        if (statisticsReady) await statistics.containment();
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
  const result = await monitor.scan(tabId, snapshot);
  if (state.tabs.has(tabId)) discardedScans.delete(tabId);
  else if ((discardedScans.get(tabId) ?? 0) < 3) {
    // A document can become identifiable between Chrome tab/context reads.
    // Retry discarded observations through the event queue, never a UI read.
    try {
      const tab = await readTab(tabId);
      if (tab.status !== 'loading') {
        discardedScans.set(tabId, (discardedScans.get(tabId) ?? 0) + 1);
        scheduleTab(tabId);
      }
    } catch { discardedScans.delete(tabId); }
  }
  return result;
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
      const allTabs = await chrome.tabs.query({});
      const ids = [...new Set([...scheduled, ...(inventoryScheduled ? allTabs.flatMap(tab =>
        tab.id !== undefined && !state.tabs.has(tab.id) ? [tab.id] : []) : [])])];
      scheduled.clear();
      inventoryScheduled = false;
      // The batch can contain newly created targets absent from the prior snapshot.
      const snapshot = await captureDebuggerSnapshot(true);
      lastCapabilities = await capabilities(snapshot);
      await recordDebuggerSnapshot(snapshot, allTabs);
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

async function applyBoundary(tabId: number): Promise<void> {
  if (!controlsReady) return;
  const tab = await readTab(tabId);
  const domain = domainFromUrl(tab.url);
  if (!domain || !canObserve(tab.url)) return;
  const rule = controls.rule(tabId, domain, config.values.monitoringEnabled && config.values.employeeControlsAllowed !== false && !emergency.snapshot().active);
  if (!rule.blocked.length && !boundaryTabs.has(tabId)) return;
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!frame?.documentId || frame.documentLifecycle !== 'active' || domainFromUrl(frame.url) !== domain) throw new Error('Delegation document changed');
  const target = { tabId, documentIds: [frame.documentId] };
  // Destination policy stays in the extension/DNR, never exposed to page code.
  const pageRule = { ...rule, allowedDomains: [], blockedDomains: [] };
  await Promise.all([
    within(chrome.scripting.executeScript({ target, world: 'MAIN', func: installApiBoundary, args: [pageRule] })),
    within(chrome.scripting.executeScript({ target, world: 'ISOLATED', func: installInteractionBoundary, args: [pageRule] })),
  ]);
  if (rule.blocked.length) boundaryTabs.add(tabId); else boundaryTabs.delete(tabId);
}

async function synchronizeControls(): Promise<void> {
  if (!controlsReady) return;
  await controls.reconcileLimits();
  const tabs = await chrome.tabs.query({});
  const view = controls.snapshot();
  const deadlines = [...view.grants.map(grant => grant.expiresAt), ...view.pauses.map(pause => pause.expiresAt)];
  if (deadlines.length) await chrome.alarms.create(CONTROL_ALARM, { when: Math.min(...deadlines) });
  else await chrome.alarms.clear?.(CONTROL_ALARM);
  const enabled = config.values.monitoringEnabled && config.values.employeeControlsAllowed !== false && !emergency.snapshot().active;
  const grants = enabled ? view.grants.filter(grant => tabs.some(tab => tab.id === grant.tabId) &&
    grant.expiresAt > Date.now() && !view.pauses.some(pause => pause.domain === null ||
      pause.domain === domainFromUrl(tabs.find(tab => tab.id === grant.tabId)?.url))) : [];
  await egress.reconcile(grants);
  const ids = [...new Set([...boundaryTabs, ...view.grants.map(grant => grant.tabId)])];
  for (let start = 0; start < ids.length; start += 4) await Promise.all(ids.slice(start, start + 4).map(async id => {
    if (!tabs.some(tab => tab.id === id)) { boundaryTabs.delete(id); return; }
    try { await applyBoundary(id); } catch { report('A page-level delegation boundary is unavailable.'); }
  }));
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
  await traffic.restoreOwners((await chrome.storage.session.get('agentguard.observation-owners.v1'))['agentguard.observation-owners.v1'], ids);
  try { await updates.load(); } catch { report('Pending update state could not be read. Automatic update application is deferred.'); }
  await emergency.load();
  try {
    await controls.load(ids); controlsReady = true;
    // Refresh surviving granted documents, including newly unrestricted presets.
    // When monitoring is off no MAIN-world code runs; earlier hooks self-expire.
    if (config.values.monitoringEnabled) for (const grant of controls.snapshot().grants) boundaryTabs.add(grant.tabId);
  }
  catch { report('Stored delegation controls could not be restored. Review controls before relying on boundaries.'); }
  try { await statistics.load(); statisticsReady = true; } catch { report('Lifetime statistics could not be restored.'); }
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
    if (!config.values.monitoringEnabled || config.values.observationAllowed === false || config.errors.length) await traffic.stopAll();
    await traffic.expire();
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
    await synchronizeControls();
    await audit.list();
    if (sessionsReady) await sessions.expire(Date.now());
    await updates.apply();
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
      activity.clear();
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
  return { config, capabilities: lastCapabilities, tabs, sessions: currentSessions, statistics: statisticsReady ? statistics.snapshot() : undefined, emergency: emergency.snapshot(), controls: controls.snapshot(), delegationNetworkTabs: egress.activeTabs(), pendingUpdate: updates.snapshot(), traffic: traffic.snapshot(), downloads: downloads.snapshot(), debuggerIntelligence: debuggerIntelligence.snapshot(), audit: await audit.list(), quarantines: [...state.quarantines.values()], healthErrors: [...healthErrors] };
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
    case 'LOOKUP_TRUST': {
      const tab = state.tabs.get(request.tabId);
      if (!tab || tab.expiresAt <= Date.now()) throw new Error('Current assessment unavailable');
      const frameworks = new Set<Framework>();
      for (const evidence of tab.evidence) {
        const definition = fingerprintDefinition(evidence.metadata.marker);
        if (definition) frameworks.add(definition.framework);
        if (evidence.detector === 'webdriver') frameworks.add('WebDriver-compatible');
      }
      return Promise.all([...frameworks].map(framework => remote.trust(framework)));
    }
    case 'LOOKUP_SITE_DECLARATION': {
      const tab = await readTab(request.tabId);
      if (!canObserve(tab.url)) throw new Error('Site unavailable');
      return remote.declaration(tab.url!);
    }
    case 'CONTRIBUTE_STATISTICS':
      if (!statisticsReady) throw new Error('Statistics unavailable');
      await remote.contribute(statistics.snapshot()); return null;
    case 'START_OBSERVATION': {
      const allowed = () => config.errors.length === 0 && config.values.monitoringEnabled && config.values.observationAllowed !== false && !emergency.snapshot().active;
      if (!allowed()) throw new Error('Observation disabled');
      const tab = await readTab(request.tabId);
      if (!canObserve(tab.url) || state.quarantines.has(request.tabId)) throw new Error('Observation target unavailable');
      await traffic.start(request.tabId);
      if (!allowed()) await traffic.stop(request.tabId);
      const deadlines = traffic.snapshot().leases.filter(lease => lease.state === 'observing').map(lease => lease.expiresAt);
      if (deadlines.length) await chrome.alarms.create(OBSERVATION_ALARM, { when: Math.min(...deadlines) });
      safely(refreshAll(), 'Observation coverage could not be refreshed.');
      await log('settings_changed'); return traffic.snapshot();
    }
    case 'STOP_OBSERVATION': await traffic.stop(request.tabId); safely(refreshAll(), 'Observation coverage could not be refreshed.'); return traffic.snapshot();
    case 'CLEAR_TRAFFIC': traffic.clear(); downloads.clear(); return null;
    case 'GRANT_ONCE': {
      const available = () => controlsReady && config.errors.length === 0 && config.values.monitoringEnabled && config.values.employeeControlsAllowed !== false && !emergency.snapshot().active && !state.quarantines.has(request.tabId);
      if (!available()) throw new Error('Allowance unavailable');
      const frame = await chrome.webNavigation.getFrame({ tabId: request.tabId, frameId: 0 });
      if (!frame || frame.documentLifecycle !== 'active' || !canObserve(frame.url)) throw new Error('Allowance document unavailable');
      const domain = domainFromUrl(frame.url)!;
      const rule = controls.rule(request.tabId, domain, available());
      if (!rule.blocked.includes(request.capability)) throw new Error('This capability has no active boundary');
      await applyBoundary(request.tabId);
      const allowance = { id: crypto.randomUUID(), capability: request.capability, expiresAt: Date.now() + 60_000 };
      const realm = ['click', 'type', 'submit'].includes(request.capability) ? 'interaction' : 'api';
      const output = await within(chrome.scripting.executeScript({ target: { tabId: request.tabId, documentIds: [frame.documentId] }, world: realm === 'interaction' ? 'ISOLATED' : 'MAIN', func: grantBoundaryOnce, args: [allowance, realm] }));
      if (!output.some(item => item.frameId === 0 && item.documentId === frame.documentId && item.result === true)) throw new Error('Allowance not installed');
      const current = await chrome.webNavigation.getFrame({ tabId: request.tabId, frameId: 0 });
      if (!available() || controls.rule(request.tabId, domain, available()).revision !== rule.revision || current?.documentId !== frame.documentId) {
        await within(chrome.scripting.executeScript({ target: { tabId: request.tabId, documentIds: [frame.documentId] }, world: realm === 'interaction' ? 'ISOLATED' : 'MAIN', func: grantBoundaryOnce, args: [null, realm] })).catch(() => undefined);
        throw new Error('Allowance cancelled because controls or document changed');
      }
      await log('settings_changed'); return allowance;
    }
    case 'APPLY_UPDATE': return updates.apply(true);
    case 'GRANT_DELEGATION': {
      if (!controlsReady || config.errors.length || config.values.employeeControlsAllowed === false || emergency.snapshot().active) throw new Error('User controls unavailable');
      const tab = await readTab(request.tabId);
      if (!canObserve(tab.url) || state.quarantines.has(request.tabId)) throw new Error('Tab unavailable for delegation');
      const view = await controls.grant(request.tabId, request.preset, request.allowedDomains, request.blockedDomains, request.minutes, config.values.maximumGrantMinutes ?? 60);
      await synchronizeControls(); await log('settings_changed'); return view;
    }
    case 'REVOKE_DELEGATION': {
      const view = await controls.revoke(request.tabId); await synchronizeControls(); await log('settings_changed'); return view;
    }
    case 'PAUSE_CONTROLS': {
      if (!controlsReady || config.errors.length || config.values.employeeControlsAllowed === false || emergency.snapshot().active) throw new Error('User pauses unavailable');
      const view = await controls.pause(request.domain, request.minutes); await synchronizeControls(); await log('settings_changed'); return view;
    }
    case 'RESUME_CONTROLS': {
      const view = await controls.resume(request.pauseId); await synchronizeControls(); await log('settings_changed'); return view;
    }
    case 'EMERGENCY_ACTIVATE': return emergency.activate(request.action);
    case 'EMERGENCY_RESET': return emergency.reset();
    case 'GET_SESSION_REPORT': {
      if (!sessionsReady) throw new Error('Session history unavailable.');
      const candidates = [...(await dashboard()).sessions, ...sessions.history()];
      const session = candidates.find(item => item.id === request.sessionId);
      if (!session) throw new Error('Session report expired or unavailable.');
      return summarizeSession(session);
    }
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
        const record = await containment.quarantine(request.tabId, domain, 'User requested emergency quarantine.');
        if (statisticsReady) await statistics.containment();
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
      let result;
      try { result = await containment.releaseAndReturn(request.tabId); }
      catch {
        report('A release was incomplete. The network rule or saved state may need cleanup; retry Release tab.');
        await log('enforcement_failed', { tabId: request.tabId, domain: record?.domain ?? null, confidence: 0 });
        throw new Error('Release was incomplete.');
      }
      await monitor.invalidate(request.tabId);
      await log('released', { tabId: request.tabId, domain: record?.domain ?? null, confidence: 0 });
      await updateBadge(request.tabId, 'UNMONITORED');
      return result;
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
      if (sensorGate.accept(source.tabId, source.documentId, signal, Date.now())) {
        if (config.values.monitoringEnabled && config.values.behaviorEnabled) activity.add(source.tabId, source.documentId, signal);
        scheduleTab(source.tabId);
      }
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
    safely(traffic.stop(tabId), 'An observation debugging session could not be detached.');
    safely(desktopAlerts.forget(tabId), 'An outdated desktop notification could not be cleared.');
    activity.forget(tabId);
    alerts.invalidate(tabId);
    void monitor.invalidate(tabId, false, false);
    safely(ready.then(refreshAlerts), 'An outdated in-page alert could not be removed; it will expire automatically.');
    safely(ready.then(async () => {
      // Already invalidated synchronously. A delayed second invalidation could
      // delete a newer completed scan while initialization was pending.
      await state.persist();
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
  traffic.detached(tabId);
  safely(traffic.stop(tabId), 'Closed observation cleanup failed.');
  safely(desktopAlerts.forget(tabId), 'Closed notification cleanup failed.');
  activity.forget(tabId);
  discardedScans.delete(tabId);
  alerts.invalidate(tabId);
  safely(ready.then(() => alerts.forget(tabId)), 'A closed tab alert preference could not be cleared.');
  sensorGate.forget(tabId);
  boundaryTabs.delete(tabId);
  safely(ready.then(async () => { await controls.revoke(tabId); await synchronizeControls(); }), 'A closed tab delegation could not be cleared.');
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
  boundaryTabs.delete(removed);
  safely(ready.then(async () => { await controls.revoke(removed); await synchronizeControls(); }), 'A replaced tab delegation could not be cleared.');
  activity.forget(removed);
  discardedScans.delete(removed);
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
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM || alarm.name === CONTROL_ALARM || alarm.name === OBSERVATION_ALARM) safely(refreshAll(), 'Scheduled monitoring failed.'); });
chrome.runtime.onInstalled.addListener(() => safely(refreshAll(), 'Initial monitoring failed.'));
chrome.runtime.onStartup.addListener(() => safely(refreshAll(), 'Startup monitoring failed.'));
chrome.runtime.onUpdateAvailable?.addListener(details => safely(ready.then(() => updates.stage(details.version)), 'An available update could not be staged.'));
chrome.debugger.onEvent?.addListener((source, method, params) => {
  if (source.tabId !== undefined && !source.sessionId) traffic.event(source.tabId, method, params);
});
chrome.debugger.onDetach?.addListener(source => { if (source.tabId !== undefined) traffic.detached(source.tabId); });
let downloadListenerInstalled = false, notificationListenerInstalled = false;
function registerOptionalEvents(): void {
  if (!downloadListenerInstalled && chrome.downloads?.onCreated) {
    chrome.downloads.onCreated.addListener(item => safely(ready.then(() => downloads.created(item)), 'Optional download handling failed. No cancellation is assumed.'));
    downloadListenerInstalled = true;
  }
  if (!notificationListenerInstalled && chrome.notifications?.onClicked) {
    chrome.notifications.onClicked.addListener(id => { if (id.startsWith('agentguard:')) safely(ready.then(() => desktopAlerts.activate(id)), 'The notification target is no longer available.'); });
    notificationListenerInstalled = true;
  }
}
registerOptionalEvents();
chrome.commands?.onCommand.addListener(command => {
  if (command === 'emergency-contain') safely(ready.then(() => emergency.activate('quarantine')), 'Emergency containment was incomplete. Open AgentGuard to review outcomes.');
});
const permissionChanged = () => safely(ready.then(async () => {
  registerOptionalEvents();
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
