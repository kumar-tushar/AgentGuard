import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Dashboard } from '../shared/contracts';
import { errorText, send } from './client';
import { Brand, Notice, StatusPill, TabAssessment } from './components';
import { useCurrentAssessments } from './freshness';
import './styles.css';

export function Popup() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invalidated, setInvalidated] = useState<Record<number, number>>({});
  const refreshPending = useRef(false);
  const currentTabs = useCurrentAssessments(dashboard?.tabs ?? []).filter((tab) => tab.assessedAt > (invalidated[tab.tabId] ?? 0));
  const assessment = currentTabs.find((tab) => tab.tabId === tabId) ?? null;

  const refresh = useCallback(async () => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const nextId = tab?.id ?? null;
      setTabId(nextId);
      const nextDashboard = await send({ type: 'GET_DASHBOARD' });
      setDashboard(nextDashboard);
      setError(nextId === null ? 'No active tab is available.' : null);
    } catch (cause) {
      setTabId(null);
      setDashboard(null);
      setError(errorText(cause));
    } finally {
      refreshPending.current = false;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    // Reading stored assessments never starts a detector or changes monitoring.
    const timer = window.setInterval(() => { if (!busy) void refresh(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [refresh, busy]);

  const act = async (type: 'QUARANTINE_TAB' | 'RELEASE_TAB' | 'CLOSE_TAB') => {
    if (tabId === null) return;
    if (type === 'CLOSE_TAB' && !window.confirm('Close this tab? Unsaved work may be lost. This does not stop an external automation controller.')) return;
    if (type === 'QUARANTINE_TAB' && !window.confirm('Quarantine this tab? Its current page will be replaced and unsaved work may be lost.')) return;
    setBusy(true);
    setError(null);
    try {
      await send({ type, tabId });
      setInvalidated((current) => ({ ...current, [tabId]: Date.now() }));
      if (type === 'CLOSE_TAB') {
        setTabId(null);
        setNotice('Tab closed. An external controller may still operate elsewhere.');
      } else {
        setNotice(type === 'QUARANTINE_TAB' ? 'Tab quarantined. This does not stop external automation.' : 'Containment released. The original page was not restored.');
      }
      setDashboard(await send({ type: 'GET_DASHBOARD' }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const quarantined = dashboard?.quarantines.some((item) => item.tabId === tabId) ?? false;
  return <main className="popup-shell">
    <header className="popup-header"><Brand section="Browser intelligence" /><button className="text-button" onClick={() => chrome.runtime.openOptionsPage()}>Settings <span aria-hidden="true">↗</span></button></header>
    <div className="popup-content">
      {error && <Notice tone="error">{error}</Notice>}
      {error && !assessment && <Notice tone="warning">Current control is unknown while monitoring data is unavailable.</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {dashboard?.healthErrors.map((item, index) => <Notice key={index} tone="warning">System: {item}</Notice>)}
      {dashboard && <section className="panel browser-summary" aria-label="Browser-wide summary"><div className="section-heading"><h2>This browser</h2><span>{currentTabs.length} tab assessments</span></div>
        <p className="muted small">Monitoring runs automatically, whether this popup is open or closed. Unobserved or expired tabs are not a safety signal.</p>
        {currentTabs.length ? <ul className="tab-summary-list">{currentTabs.map((tab) => <li key={tab.tabId}><div><strong>{tab.domain ?? 'Domain unavailable'}</strong><small>Tab {tab.tabId}{tab.tabId === tabId ? ' · Current tab' : ''}</small></div><StatusPill status={tab.status} /></li>)}</ul> : <p className="muted">No stored tab assessments yet.</p>}
      </section>}
      {!assessment && !error && <section className="panel" aria-label="Current tab assessment"><h1>Unmonitored</h1><p className="muted">{dashboard?.config.values.monitoringEnabled === false ? 'Automatic monitoring is disabled in settings.' : 'No current assessment is available for this tab. Automatic monitoring may be pending or Chrome may restrict access.'} This does not mean the tab is safe.</p></section>}
      {assessment && <TabAssessment assessment={assessment} />}
      <section className="panel action-panel" aria-label="Tab controls"><div className="section-heading"><h2>Tab controls</h2><span>Current tab only</span></div>
        <div className="action-row">
          {quarantined ? <button className="button button-outline" onClick={() => void act('RELEASE_TAB')} disabled={busy || tabId === null}>Release tab</button> : <button className="button button-outline" onClick={() => void act('QUARANTINE_TAB')} disabled={busy || tabId === null}>Quarantine tab</button>}
          <button className="button button-danger" onClick={() => void act('CLOSE_TAB')} disabled={busy || tabId === null}>Close tab</button></div>
        <p className="muted small">Containment affects this tab, not the external controller. Closing may discard unsaved work.</p>
      </section>
    </div>
    <footer className="popup-footer">Local assessment · No page contents collected</footer>
  </main>;
}

const rootElement = document.getElementById('root');
if (rootElement) createRoot(rootElement).render(<Popup />);
