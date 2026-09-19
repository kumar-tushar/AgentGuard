import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Dashboard, QuarantineRecord } from '../shared/contracts';
import { errorText, send, timeText } from './client';
import { Brand, Notice } from './components';
import './styles.css';

export function Blocked() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [record, setRecord] = useState<QuarantineRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [released, setReleased] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const tab = await chrome.tabs.getCurrent();
        if (tab?.id === undefined) throw new Error('This containment page is not in a browser tab.');
        const dashboard: Dashboard = await send({ type: 'GET_DASHBOARD' });
        if (!active) return;
        setTabId(tab.id);
        setRecord(dashboard.quarantines.find((item) => item.tabId === tab.id) ?? null);
      } catch (cause) {
        if (active) setError(errorText(cause));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const release = async () => {
    if (tabId === null) return;
    setLoading(true);
    setError(null);
    try {
      await send({ type: 'RELEASE_TAB', tabId });
      setRecord(null);
      setReleased(true);
    } catch (cause) { setError(errorText(cause)); } finally { setLoading(false); }
  };

  return <div className="blocked-shell"><header><Brand section="Containment" /></header><main className="blocked-card"><div className="blocked-icon" aria-hidden="true">!</div><span className="eyebrow">AGENTGUARD / TAB CONTAINMENT</span><h1>{released ? 'Containment released' : record ? 'This tab is quarantined' : loading ? 'Checking containment' : 'Containment not confirmed'}</h1><p>{released ? 'The network rule has been removed. Your original page was not stored or restored.' : record ? 'AgentGuard replaced the current page after a local policy or manual action. The original page is not retained.' : 'This page alone does not confirm that quarantine or network blocking is active.'}</p>
    {error && <Notice tone="error">{error}</Notice>}
    {loading ? <p role="status" className="muted">Checking containment status…</p> : record ? <div className="blocked-facts"><div><span>Domain</span><strong>{record.domain ?? 'Unavailable'}</strong></div><div><span>Quarantined</span><strong>{timeText(record.createdAt)}</strong></div><div><span>Reason</span><strong>{record.reason}</strong></div><div><span>Network blocking</span><strong>{record.networkBlocked ? 'Active for authorized hosts' : 'Not active'}</strong></div></div> : !released && <Notice tone="warning">No active quarantine record was found for this tab. The page may have been released or the record may be unavailable.</Notice>}
    <div className="blocked-actions">{record && <button className="button button-primary" onClick={() => void release()} disabled={loading}>Release this tab</button>}<button className="button button-outline" onClick={() => chrome.runtime.openOptionsPage()}>Open AgentGuard settings</button></div>
    <p className="muted small">Quarantine does not terminate an external agent, undo earlier requests or prevent it from opening another tab. Reopening a sensitive site may trigger policy again.</p></main><footer>Local protection · No page contents retained</footer></div>;
}

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<Blocked />);
