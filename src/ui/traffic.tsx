import { useState } from 'react';
import type { Dashboard, TabAgentStatus } from '../shared/contracts';
import type { DownloadPolicy } from '../shared/traffic';
import { errorText, send, timeText } from './client';
import { Notice } from './components';

export function TrafficControls({ dashboard, tabs, permissions, onChanged }: { dashboard: Dashboard; tabs: TabAgentStatus[]; permissions?: string[]; onChanged(): void }) {
  const [tabId, setTabId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setError(null); try { await work(); onChanged(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  const downloadPolicy = async (policy: DownloadPolicy) => {
    if (policy === 'block_all' && !window.confirm('Cancel ALL new downloads in this browser, including human downloads? Chrome does not reliably identify the originating tab. Previously completed files cannot be recalled.')) return;
    // Permission requests run directly from the user's gesture, before other awaits.
    const granted = policy === 'off' || await chrome.permissions.request({ permissions: ['downloads'] });
    if (!granted) throw new Error('Download permission was not granted');
    await send({ type: 'SAVE_CONFIG', config: { ...dashboard.config.values, downloadPolicy: policy } });
  };
  const notifications = async () => {
    const enabled = !dashboard.config.values.desktopNotifications;
    if (enabled && !await chrome.permissions.request({ permissions: ['notifications'] })) throw new Error('Notification permission was not granted');
    await send({ type: 'SAVE_CONFIG', config: { ...dashboard.config.values, desktopNotifications: enabled } });
  };
  return <div className="console-stack">
    {error && <Notice tone="error">{error}</Notice>}
    <Notice>Optional download access: {permissions?.includes('downloads') && dashboard.config.values.monitoringEnabled ? 'granted; configured policy and actual outcomes are shown below' : 'unavailable or not verified; do not assume downloads are being monitored or blocked'}. Desktop notification access: {permissions?.includes('notifications') ? 'granted (OS delivery is not guaranteed)' : 'unavailable or not verified'}.</Notice>
    <section className="panel"><h2>Optional tab traffic observation</h2><Notice tone="warning">This explicitly attaches AgentGuard’s debugger for up to 15 minutes. Chrome shows a debugging banner and may refuse access because of enterprise policy or another debugger. Observation is tab-wide, not agent attribution. Navigation ends the session. Passive attachment detection is suspended during AgentGuard-owned observation to avoid self-detection.</Notice>
      <label className="field"><span>Observation tab</span><select aria-label="Observation tab" value={tabId ?? ''} onChange={event => setTabId(Number(event.target.value))}><option value="" disabled>Select a tab</option>{tabs.filter(tab => tab.domain).map(tab => <option key={tab.tabId} value={tab.tabId}>{tab.domain} · tab {tab.tabId}</option>)}</select></label>
      <button className="button button-outline" disabled={busy || tabId === null || dashboard.config.values.observationAllowed === false} onClick={() => { if (window.confirm('Attach AgentGuard’s debugger to this tab for metadata-only traffic observation? This may conflict with other debugging tools.')) void run(() => send({ type: 'START_OBSERVATION', tabId: tabId! })); }}>Start 15-minute observation</button>
      {dashboard.traffic?.leases.map(lease => <div key={lease.tabId}><p>Tab {lease.tabId}: {lease.state} · expires {timeText(lease.expiresAt)}<br />{lease.reason}</p><button className="button button-outline" disabled={busy} onClick={() => void run(() => send({ type: 'STOP_OBSERVATION', tabId: lease.tabId }))}>Stop observation · tab {lease.tabId}</button></div>)}
      <p className="muted small">Only hostnames, fixed request methods/status codes and timestamps are retained in worker memory (500 records maximum). No bodies, headers, cookies, filenames or full URLs are stored. Child targets, workers and other browser traffic may be missed. A zero count does not establish inactivity.</p>
      <div className="table-scroll"><table><thead><tr><th>Time</th><th>Tab</th><th>Host</th><th>Observation</th></tr></thead><tbody>{dashboard.traffic?.records.slice(-100).reverse().map(record => <tr key={record.id}><td>{timeText(record.timestamp)}</td><td>{record.tabId}</td><td>{record.domain}</td><td>{record.kind} · {record.method} {record.status ?? ''} · initiator unknown</td></tr>)}{!dashboard.traffic?.records.length && <tr><td colSpan={4} className="empty-cell">No traffic observations yet. Start an observation to collect metadata.</td></tr>}</tbody></table></div>
    </section>
    <section className="panel"><h2>Browser download policy</h2><p>Downloads have no reliable Chrome tab ID. They are never assigned to a sole active agent, and cancellation is not proof that an external controller stopped.</p><div className="action-row">{(['off', 'observe', 'block_all'] as const).map(policy => <button key={policy} className="button button-outline" disabled={busy || dashboard.config.managedKeys.includes('downloadPolicy')} onClick={() => void run(() => downloadPolicy(policy))}>{policy === 'off' ? 'Disable download handling' : policy === 'observe' ? 'Observe download hostnames' : 'Block ALL browser downloads'}</button>)}</div><p>Current policy: {dashboard.config.values.downloadPolicy ?? 'off'}. Permission denial means unavailable handling.</p><ul>{dashboard.downloads?.slice(-50).reverse().map((record, index) => <li key={`${record.id}:${index}`}>{timeText(record.timestamp)} · {record.domain ?? 'Host unavailable'} · tab unknown · {record.action.replaceAll('_', ' ')}</li>)}</ul></section>
    <section className="panel"><h2>Desktop alerts</h2><p>Optional OS notifications contain no hostname or URL. Clicking switches to the affected tab only if its current assessment still matches. In-page notices remain independent.</p><button className="button button-outline" disabled={busy || dashboard.config.managedKeys.includes('desktopNotifications')} onClick={() => void run(notifications)}>{dashboard.config.values.desktopNotifications ? 'Disable desktop alerts' : 'Enable desktop alerts'}</button></section>
    <button className="button button-outline" disabled={busy} onClick={() => void run(() => send({ type: 'CLEAR_TRAFFIC' }))}>Clear traffic and download records</button>
  </div>;
}
