import { useState } from 'react';
import type { Dashboard, TabAgentStatus } from '../shared/contracts';
import type { ActionCapability, GrantPreset } from '../shared/controls';
import { errorText, send, timeText } from './client';
import { Notice } from './components';

export function DelegationControls({ dashboard, tab, onChanged }: { dashboard: Dashboard; tab: TabAgentStatus | null; onChanged(): void }) {
  const [preset, setPreset] = useState<GrantPreset>('READ_ONLY');
  const [minutes, setMinutes] = useState(15);
  const [allowed, setAllowed] = useState('');
  const [blocked, setBlocked] = useState('');
  const [onceCapability, setOnceCapability] = useState<ActionCapability>('click');
  const [allowanceNotice, setAllowanceNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const grant = dashboard.controls?.grants.find(item => item.tabId === tab?.tabId);
  const disabled = busy || dashboard.config.values.employeeControlsAllowed === false || dashboard.emergency?.active === true || dashboard.config.errors.length > 0;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); onChanged(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  const split = (input: string) => input.split(/[\n,]/u).map(value => value.trim()).filter(Boolean);
  return <section className="panel" aria-label="Delegation and pauses"><h2>Delegation and pauses</h2>
    {error && <Notice tone="error">{error}</Notice>}
    <p className="muted small">Page controls are best effort against recognizable in-page scripts and synthetic events. Native CDP, accessibility and OS input may bypass them. Site network rules, when enabled, affect all traffic in the tab—not just an agent.</p>
    {dashboard.config.values.employeeControlsAllowed === false && <Notice tone="warning">User delegations and pauses are disabled by organization policy.</Notice>}
    {tab?.domain ? <>
      <p>Tab {tab.tabId} · {tab.domain}</p>
      {grant && <p>Active: {grant.preset.replaceAll('_', ' ')} · expires {timeText(grant.expiresAt)}. Network site rules: {dashboard.delegationNetworkTabs?.includes(tab.tabId) ? 'Installed for authorized hosts' : 'Not installed'}.</p>}
      <label className="field"><span>Delegation preset</span><select value={preset} onChange={event => setPreset(event.target.value as GrantPreset)} disabled={disabled}><option value="READ_ONLY">Read only</option><option value="LIMITED">Limited interaction</option><option value="FULL_ACCESS">Full access (time-bounded)</option></select></label>
      <label className="field"><span>Duration (minutes)</span><input type="number" min="1" max={dashboard.config.values.maximumGrantMinutes ?? 60} value={minutes} onChange={event => setMinutes(Number(event.target.value))} disabled={disabled} /></label>
      <details><summary>Allowed and blocked sites</summary><label className="field"><span>Allowed domains (required for Limited)</span><textarea value={allowed} onChange={event => setAllowed(event.target.value)} placeholder={tab.domain} disabled={disabled} /></label><label className="field"><span>Blocked domains (deny wins)</span><textarea value={blocked} onChange={event => setBlocked(event.target.value)} disabled={disabled} /></label></details>
      <div className="action-row"><button className="button button-primary" disabled={disabled} onClick={() => void run(() => send({ type: 'GRANT_DELEGATION', tabId: tab.tabId, preset, minutes, allowedDomains: split(allowed || (preset === 'LIMITED' ? tab.domain! : '')), blockedDomains: split(blocked) }))}>Apply delegation</button>{grant && <button className="button button-outline" disabled={busy} onClick={() => void run(() => send({ type: 'REVOKE_DELEGATION', tabId: tab.tabId }))}>Revoke delegation</button>}</div>
      {grant && <details><summary>Allow one blocked page operation</summary><label className="field"><span>One-time capability</span><select value={onceCapability} onChange={event => setOnceCapability(event.target.value as ActionCapability)} disabled={disabled}>{(['click', 'type', 'submit', 'network', 'navigate', 'open_window', 'modify_dom'] as const).map(capability => <option key={capability} value={capability}>{capability.replaceAll('_', ' ')}</option>)}</select></label><button className="button button-outline" disabled={disabled} onClick={() => void run(async () => { await send({ type: 'GRANT_ONCE', tabId: tab.tabId, capability: onceCapability }); setAllowanceNotice('One matching page operation allowed for up to 60 seconds in this document. Network rules and sensitive-domain policies are unchanged.'); })}>Allow once</button>{allowanceNotice && <p role="status">{allowanceNotice}</p>}</details>}
      <div className="action-row"><button className="button button-outline" disabled={disabled} onClick={() => void run(() => send({ type: 'PAUSE_CONTROLS', domain: tab.domain, minutes: 15 }))}>Pause on this site · 15 min</button><button className="button button-outline" disabled={disabled} onClick={() => void run(() => send({ type: 'PAUSE_CONTROLS', domain: tab.domain, minutes: 60 }))}>Pause on this site · 60 min</button></div>
    </> : <p className="muted">Select an accessible web tab for per-tab delegation.</p>}
    <button className="button button-outline" disabled={disabled} onClick={() => { if (window.confirm('Pause user delegation boundaries everywhere for 15 minutes? Monitoring, sensitive-domain policies and the emergency latch remain active.')) void run(() => send({ type: 'PAUSE_CONTROLS', domain: null, minutes: 15 })); }}>Pause delegation everywhere · 15 min</button>
    {dashboard.controls?.pauses.map(pause => <div key={pause.id}><p>{pause.domain ?? 'Everywhere'} · resumes {timeText(pause.expiresAt)}</p><button className="button button-outline" disabled={busy} onClick={() => void run(() => send({ type: 'RESUME_CONTROLS', pauseId: pause.id }))}>Resume {pause.domain ?? 'everywhere'}</button></div>)}
    <p className="muted small">Revoking or expiring a delegation removes its optional boundaries; it does not terminate a controller. Pauses never suppress detection or override sensitive-domain policy. One-time exceptions apply to one event/API path, not a complete multi-event gesture, and cannot bypass browser network rules.</p>
  </section>;
}
