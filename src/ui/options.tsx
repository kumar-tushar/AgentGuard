import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentGuardConfig, AuditEvent, Dashboard, TabAgentStatus } from '../shared/contracts';
import { errorText, scoreText, send, timeText } from './client';
import { Brand, Notice, StatusPill } from './components';
import { useCurrentAssessments } from './freshness';
import { Sessions } from './sessions';
import { DebuggerHistory } from './debugger-history';
import './styles.css';

type Section = 'overview' | 'sessions' | 'policy' | 'coverage' | 'audit';
type GrantedPermissions = { permissions: string[]; origins: string[] };

function EventRow({ event }: { event: AuditEvent }) {
  return <tr><td>{timeText(event.timestamp)}</td><td><strong>{event.eventType.replaceAll('_', ' ')}</strong><div className="table-detail">{event.detail}</div></td><td>{event.domain ?? '—'}</td><td>{event.tabId ?? '—'}</td><td>{event.detectedAgent ?? 'Not identified'}</td><td>{scoreText(event.confidence)}</td><td>{event.policyAction}</td></tr>;
}

function TabRow({ tab }: { tab: TabAgentStatus }) {
  return <tr><td><strong>{tab.domain ?? 'Domain unavailable'}</strong><div className="table-detail">Tab {tab.tabId}</div></td><td><StatusPill status={tab.status} /></td><td>{scoreText(tab.confidence)}</td><td>{tab.policy.action}</td><td>{timeText(tab.assessedAt)}</td></tr>;
}

export function Options() {
  const [section, setSection] = useState<Section>('overview');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [draft, setDraft] = useState<AgentGuardConfig | null>(null);
  const [domainsText, setDomainsText] = useState('');
  const [granted, setGranted] = useState<GrantedPermissions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentTabs = useCurrentAssessments(dashboard?.tabs ?? []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextDashboard, permissions] = await Promise.all([send({ type: 'GET_DASHBOARD' }), chrome.permissions.getAll()]);
      setDashboard(nextDashboard);
      setDraft(nextDashboard.config.values);
      setDomainsText(nextDashboard.config.values.sensitiveDomains.join('\n'));
      setGranted({ permissions: permissions.permissions ?? [], origins: permissions.origins ?? [] });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const isLocked = (key: keyof AgentGuardConfig) => dashboard?.config.managedKeys.includes(key) ?? false;
  const update = <K extends keyof AgentGuardConfig>(key: K, value: AgentGuardConfig[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const save = async () => {
    if (!draft) return;
    const domains = domainsText.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    const config: AgentGuardConfig = { ...draft, sensitiveDomains: domains };
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const effective = await send({ type: 'SAVE_CONFIG', config });
      setDraft(effective.values);
      setDomainsText(effective.values.sensitiveDomains.join('\n'));
      setNotice('Settings saved. Managed values remain controlled by your organization.');
      setDashboard(await send({ type: 'GET_DASHBOARD' }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const refreshPermissions = async () => {
    const permissions = await chrome.permissions.getAll();
    setGranted({ permissions: permissions.permissions ?? [], origins: permissions.origins ?? [] });
    setDashboard(await send({ type: 'GET_DASHBOARD' }));
  };

  const grantBlocking = async () => {
    const request = chrome.permissions.request({ permissions: ['declarativeNetRequestWithHostAccess'] });
    setBusy(true);
    setError(null);
    try {
      if (!(await request)) throw new Error('Network blocking permission was not granted. Quarantine still replaces the tab page.');
      setNotice('Network blocking permission granted. It applies only to authorized hosts.');
      await refreshPermissions();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };

  const revokeBlocking = async () => {
    setBusy(true);
    setError(null);
    try {
      const removed = await chrome.permissions.remove({ permissions: ['declarativeNetRequestWithHostAccess'] });
      if (!removed) throw new Error('Chrome did not revoke this permission. It may be required or enterprise-managed.');
      setNotice('Permission revoked. Coverage or containment may be reduced.');
      await refreshPermissions();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };

  const openSiteSettings = async () => {
    try { await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }); }
    catch (cause) { setError(errorText(cause)); }
  };

  const exportAudit = async () => {
    setBusy(true);
    setError(null);
    try {
      const envelope = await send({ type: 'EXPORT_AUDIT' });
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agentguard-audit-${new Date(envelope.exportedAt).toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(`Exported ${envelope.events.length} local events. Handle domain names as sensitive telemetry.`);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };

  const clearAudit = async () => {
    if (!window.confirm('Permanently clear the local AgentGuard audit log on this browser? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await send({ type: 'CLEAR_AUDIT' });
      setDashboard(await send({ type: 'GET_DASHBOARD' }));
      setNotice('Local audit log cleared.');
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };

  const values = draft;
  return <div className="console-shell">
    <aside className="console-nav"><Brand section="Security console" /><p className="nav-caption">THIS BROWSER</p><nav aria-label="Settings sections">
      {([['overview', 'Overview'], ['sessions', 'Sessions'], ['policy', 'Policy settings'], ['coverage', 'Coverage & permissions'], ['audit', 'Audit log']] as const).map(([id, label]) => <button key={id} className={`nav-link ${section === id ? 'active' : ''}`} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}
    </nav><div className="nav-foot">Local-only monitoring<br />No organization-wide backend connected</div></aside>
    <main className="console-main"><header className="console-top"><div><span className="eyebrow">AGENTGUARD / {section.toUpperCase()}</span><h1>{section === 'overview' ? 'Browser overview' : section === 'sessions' ? 'Automation sessions' : section === 'policy' ? 'Policy settings' : section === 'coverage' ? 'Coverage & permissions' : 'Local audit log'}</h1><p>{section === 'overview' ? 'Automation signals and policy activity on this browser.' : section === 'sessions' ? 'Current observations, bounded local history and explainable timelines.' : section === 'policy' ? 'Set local safeguards. Managed settings are locked by your organization.' : section === 'coverage' ? 'Review automatic monitoring coverage and Chrome-controlled site access.' : 'Review bounded events stored on this browser.'}</p></div><button className="button button-outline" onClick={() => void refresh()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh data'}</button></header>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {dashboard?.healthErrors.map((item, index) => <Notice key={index} tone="warning">System: {item}</Notice>)}
      {dashboard?.config.errors.map((item, index) => <Notice key={`managed-${index}`} tone="error">Configuration: {item}</Notice>)}
      {!dashboard && !error && <div className="loading-state" role="status">Loading live AgentGuard data…</div>}

      {dashboard && section === 'overview' && <div className="console-stack"><div className="metric-grid"><div className="metric-card"><span className="eyebrow">Monitored tabs</span><strong>{currentTabs.length}</strong><small>Known to this browser</small></div><div className="metric-card"><span className="eyebrow">Automation likely</span><strong>{currentTabs.filter((tab) => tab.status === 'AUTOMATION_LIKELY').length}</strong><small>Corroborated signals, not proof of AI</small></div><div className="metric-card"><span className="eyebrow">Automation suspected</span><strong>{currentTabs.filter((tab) => tab.status === 'AUTOMATION_SUSPECTED').length}</strong><small>Needs review</small></div><div className="metric-card"><span className="eyebrow">Quarantined</span><strong>{dashboard.quarantines.length}</strong><small>Current browser tabs</small></div></div>
        {currentTabs.some((tab, index) => tab !== dashboard.tabs[index]) && <Notice tone="warning">Some assessments expired. Awaiting new automatic monitoring evidence; refreshing this view only reads stored data.</Notice>}
        <section className="console-panel"><div className="panel-header"><div><h2>Recent tab assessments</h2><p>Statuses expire; unobserved tabs may not appear here.</p></div></div><div className="table-scroll"><table><thead><tr><th>Domain / tab</th><th>Assessment</th><th>Score</th><th>Policy</th><th>Assessed</th></tr></thead><tbody>{currentTabs.length ? currentTabs.map((tab) => <TabRow key={tab.tabId} tab={tab} />) : <tr><td colSpan={5} className="empty-cell">No tab assessments yet.</td></tr>}</tbody></table></div></section>
        <Notice>AgentGuard reports local browser evidence only. No organization-wide agent inventory or verified AI identity is available without a separately deployed, authenticated backend.</Notice>
      </div>}

      {dashboard && section === 'sessions' && <Sessions sessions={dashboard.sessions} tabs={currentTabs} retention={dashboard.config.values} />}

      {dashboard && values && section === 'policy' && <div className="console-stack"><section className="console-panel"><div className="panel-header"><div><h2>Detection</h2><p>Signals are processed locally. AgentGuard never reads page contents or form values.</p></div></div><div className="field-stack"><label className="toggle-field"><span><strong>Monitoring enabled</strong><small>Monitor authorized tabs automatically, including while the popup is closed.</small></span><input type="checkbox" checked={values.monitoringEnabled} disabled={busy || isLocked('monitoringEnabled')} onChange={(event) => update('monitoringEnabled', event.target.checked)} />{isLocked('monitoringEnabled') && <em>Managed</em>}</label><label className="toggle-field"><span><strong>Behavioral signals</strong><small>Collect bounded event counts and coarse timing only; no values or coordinates.</small></span><input type="checkbox" checked={values.behaviorEnabled} disabled={busy || isLocked('behaviorEnabled')} onChange={(event) => update('behaviorEnabled', event.target.checked)} />{isLocked('behaviorEnabled') && <em>Managed</em>}</label></div></section>
        <section className="console-panel"><div className="panel-header"><div><h2>Session history retention</h2><p>Local session history is separate from the audit log. A zero limit disables ended-session retention, not current monitoring.</p></div></div><div className="form-grid">
          <label className="field"><span>Session retention days {isLocked('sessionRetentionDays') && <em>Managed</em>}</span><input type="number" min="1" max="90" step="1" value={values.sessionRetentionDays} disabled={busy || isLocked('sessionRetentionDays')} onChange={event => update('sessionRetentionDays', Number(event.target.value))} /></label>
          <label className="field"><span>Maximum ended sessions {isLocked('maxHistorySessions') && <em>Managed</em>}</span><input type="number" min="0" max="500" step="1" value={values.maxHistorySessions} disabled={busy || isLocked('maxHistorySessions')} onChange={event => update('maxHistorySessions', Number(event.target.value))} /></label>
        </div></section>
        <section className="console-panel"><div className="panel-header"><div><h2>Response policy</h2><p>Detection and policy are separate. Blocking is reactive, not a complete DLP boundary.</p></div></div><div className="form-grid"><label className="field"><span>Policy mode {isLocked('policyMode') && <em>Managed</em>}</span><select value={values.policyMode} disabled={busy || isLocked('policyMode')} onChange={(event) => update('policyMode', event.target.value as AgentGuardConfig['policyMode'])}><option value="monitor">Monitor — record only</option><option value="warn">Warn — surface risk</option><option value="block">Block — quarantine matching sensitive tabs</option></select></label><label className="field"><span>Minimum evidence score (%) {isLocked('minimumConfidence') && <em>Managed</em>}</span><input type="number" min="10" max="100" step="1" value={Math.round(values.minimumConfidence * 100)} disabled={busy || isLocked('minimumConfidence')} onChange={(event) => update('minimumConfidence', Number(event.target.value) / 100)} /><small>Heuristic threshold, not a probability.</small></label></div><label className="field"><span>Sensitive domains {isLocked('sensitiveDomains') && <em>Managed</em>}</span><textarea rows={6} spellCheck={false} placeholder={'example.com\ninternal.example.org'} value={domainsText} disabled={busy || isLocked('sensitiveDomains')} onChange={(event) => setDomainsText(event.target.value)} /><small>One hostname per line. Exact host and subdomains match on label boundaries.</small></label></section>
        <section className="console-panel"><div className="panel-header"><div><h2>Local audit retention</h2><p>Events contain tab IDs, domains and outcomes; no page paths or content.</p></div></div><div className="form-grid"><label className="field"><span>Retention days {isLocked('retentionDays') && <em>Managed</em>}</span><input type="number" min="1" max="90" step="1" value={values.retentionDays} disabled={busy || isLocked('retentionDays')} onChange={(event) => update('retentionDays', Number(event.target.value))} /></label><label className="field"><span>Maximum events {isLocked('maxAuditEvents') && <em>Managed</em>}</span><input type="number" min="100" max="5000" step="1" value={values.maxAuditEvents} disabled={busy || isLocked('maxAuditEvents')} onChange={(event) => update('maxAuditEvents', Number(event.target.value))} /></label></div></section><div className="save-bar"><span>Invalid settings will be rejected; managed fields cannot be edited here.</span><button className="button button-primary" disabled={busy} onClick={() => void save()}>Save policy</button></div></div>}

      {dashboard && section === 'coverage' && <div className="console-stack"><div className="metric-grid two"><div className="metric-card"><span className="eyebrow">Debugger observation</span><strong className="metric-word">{dashboard.capabilities.debugger ? 'Available' : 'Unavailable'}</strong><small>Passive attachment indicator only. DevTools and external automation cannot reliably be distinguished.</small></div><div className="metric-card"><span className="eyebrow">Network containment</span><strong className="metric-word">{dashboard.capabilities.networkBlocking ? 'Available' : 'Limited'}</strong><small>Optional request blocking only on authorized hosts; tab replacement still works.</small></div></div>
        <section className="console-panel"><div className="panel-header"><div><h2>Site access</h2><p>AgentGuard declares HTTP and HTTPS host access for automatic monitoring across browser tabs. Opening the popup does not start detection or grant access. Chrome site-access settings or organization policy can withhold this access.</p></div></div><div className="granted-list"><h3>Origins reported by Chrome</h3>{granted?.origins.length ? granted.origins.map((origin) => <div className="granted-item" key={origin}><code>{origin}</code></div>) : <p className="muted">Chrome reports no host access. Detection coverage is limited.</p>}</div><div className="wide-grant"><div><strong>Chrome controls site access</strong><p>Open the extension details and review Site access. Required host permissions cannot be removed here. Reported origins alone do not guarantee every tab is observable.</p></div><button className="button button-outline" disabled={busy} onClick={() => void openSiteSettings()}>Open Chrome site settings</button></div></section>
        <section className="console-panel"><div className="panel-header"><div><h2>Optional containment</h2><p>Quarantine replaces the page. With this permission, network requests in the quarantined tab can also be blocked on authorized hosts.</p></div></div>{granted?.permissions.includes('declarativeNetRequestWithHostAccess') ? <button className="button button-outline" disabled={busy} onClick={() => void revokeBlocking()}>Revoke network blocking</button> : <button className="button button-primary" disabled={busy} onClick={() => void grantBlocking()}>Enable network blocking</button>}</section>
        <DebuggerHistory view={dashboard.debuggerIntelligence} />
        <Notice tone="warning">Debugger permission is included in every AgentGuard installation. Chrome or organization policy may still restrict debugger access. Unavailable access means reduced detection coverage, never proof that a tab is human-controlled or safe. Availability here does not guarantee coverage for every tab. Internal pages, other extensions, unobserved frames and denied hosts remain blind spots.</Notice>
      </div>}

      {dashboard && section === 'audit' && <div className="console-stack"><section className="console-panel"><div className="panel-header"><div><h2>Recorded events</h2><p>{dashboard.audit.length} events retained locally. Export is explicit; no telemetry is uploaded. Evidence scores are heuristic support, not probabilities of AI control.</p></div><div className="panel-actions"><button className="button button-outline" disabled={busy} onClick={() => void exportAudit()}>Export JSON</button><button className="button button-danger" disabled={busy || !dashboard.audit.length} onClick={() => void clearAudit()}>Clear log</button></div></div><div className="table-scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Domain</th><th>Tab</th><th>Detected agent</th><th>Evidence score</th><th>Policy</th></tr></thead><tbody>{dashboard.audit.length ? dashboard.audit.map((event) => <EventRow key={event.id} event={event} />) : <tr><td colSpan={7} className="empty-cell">No audit events recorded.</td></tr>}</tbody></table></div></section><Notice>Exports include potentially sensitive hostnames. The local log is bounded and is not tamper-evident.</Notice></div>}
    </main>
  </div>;
}

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<Options />);
