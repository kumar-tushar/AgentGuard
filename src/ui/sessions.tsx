import { useCallback, useEffect, useState } from 'react';
import type { AgentGuardConfig, TabAgentStatus, TabState } from '../shared/contracts';
import type { ActivityCounters, AgentSession } from '../shared/intelligence';
import { errorText, scoreText, send, timeText } from './client';
import { Notice, StatusPill } from './components';
import { useCurrentAssessments } from './freshness';

const activityLabels: Record<keyof ActivityCounters, string> = {
  navigations: 'Navigations', pointerInteractions: 'Pointer interactions', keyboardInteractions: 'Keyboard interactions',
  inputInteractions: 'Input interactions', scrolls: 'Scrolls', submits: 'Submits', syntheticInteractions: 'Synthetic interactions',
};

function currentState(session: AgentSession, tabs: readonly TabAgentStatus[], now: number): TabState {
  const tab = tabs.find((item) => item.tabId === session.tabId);
  if (!tab || tab.status === 'UNMONITORED' || session.expiresAt <= now || tab.domain !== session.domain) return 'UNMONITORED';
  if (tab.assessedAt > session.lastObservedAt) return tab.status;
  if (session.controlState === 'AGENT_ACTIVE' && (session.lastActivityAt === null || now - session.lastActivityAt >= 30_000)) return 'AGENT_CONNECTED';
  return session.controlState;
}

function SessionCard({ session, state, historical }: { session: AgentSession; state: TabState; historical: boolean }) {
  const hasCurrentEvidence = historical || state !== 'UNMONITORED';
  return <article className="session-card" aria-label={`${historical ? 'Historical' : 'Current'} session on ${session.domain ?? 'unknown domain'}, tab ${session.tabId}`}>
    <div className="session-heading"><div><h3>{session.domain ?? 'Domain unavailable'}</h3><small>Tab {session.tabId} · {historical ? 'Ended session' : 'Observation session'}</small></div><StatusPill status={state} /></div>
    <dl className="session-facts">
      <div><dt>Controller</dt><dd>{hasCurrentEvidence ? session.controller.displayName ?? 'Unknown' : 'Unknown'}</dd></div>
      <div><dt>Attribution</dt><dd>{hasCurrentEvidence ? session.controller.attributionLevel.replaceAll('_', ' ').toLowerCase() : 'Unavailable for current tab'}</dd></div>
      <div><dt>{historical ? 'Last control score' : 'Control score'}</dt><dd>{hasCurrentEvidence ? scoreText(session.controlScore) : 'Unavailable'}</dd></div>
      <div><dt>Framework hints</dt><dd>{session.automationStack.frameworks.join(', ') || 'None observed'} <small>Unverified, not controller identity</small></dd></div>
      <div><dt>Transport hints</dt><dd>{session.automationStack.transports.join(', ') || 'Unknown'}</dd></div>
      <div><dt>Environment hints</dt><dd>{session.automationStack.environmentHints.join(', ') || 'None observed'}</dd></div>
      <div><dt>Started</dt><dd>{timeText(session.startedAt)}</dd></div>
      <div><dt>Last activity observed</dt><dd>{timeText(session.lastActivityAt)}</dd></div>
      <div><dt>Last observation</dt><dd>{timeText(session.lastObservedAt)}</dd></div>
      {historical && <div><dt>Ended</dt><dd>{timeText(session.endedAt)} · {session.endReason?.replaceAll('_', ' ') ?? 'Reason unavailable'}</dd></div>}
    </dl>
    {!historical && !hasCurrentEvidence && <p className="muted small">Current coverage is unavailable or expired. Session details below describe earlier observations, not current control.</p>}
    <details className="session-details"><summary>Activity and timeline</summary>
      <p className="muted small">Counts describe activity in this tab, not proof the controller performed it. No entered values or page contents are recorded.</p>
      <p className="muted small">Activity integration is not yet enabled in this build; zero counters are not proof of inactivity.</p>
      <dl className="session-counts">{Object.entries(activityLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{session.observedActivity[key as keyof ActivityCounters]}</dd></div>)}</dl>
      <h4>Observation timeline</h4>
      {session.timeline.length ? <ol className="session-timeline">{session.timeline.map((event) => <li key={event.id}><div><span className={`timeline-kind timeline-${event.kind.toLowerCase()}`}>{event.kind}</span><time dateTime={new Date(event.timestamp).toISOString()}>{timeText(event.timestamp)}</time></div><p>{event.description}</p></li>)}</ol> : <p className="muted">No retained timeline events.</p>}
    </details>
  </article>;
}

export function Sessions({ sessions, tabs, retention }: { sessions: readonly AgentSession[]; tabs: readonly TabAgentStatus[]; retention: Pick<AgentGuardConfig, 'sessionRetentionDays' | 'maxHistorySessions'> }) {
  const [history, setHistory] = useState<AgentSession[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const currentTabs = useCurrentAssessments(tabs);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadHistory = useCallback(async () => {
    setBusy(true);
    setError(null);
    try { setHistory(await send({ type: 'GET_SESSION_HISTORY' })); }
    catch (cause) { setHistory(null); setError(errorText(cause)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory, sessions]);

  const exportSessions = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const report = await send({ type: 'EXPORT_SESSIONS' });
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `agentguard-sessions-${new Date(report.exportedAt).toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(`Exported ${report.sessions.length} current and ${report.history.length} historical sessions. Handle domain names as sensitive telemetry.`);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };

  const clearHistory = async () => {
    if (!window.confirm('Permanently clear ended AgentGuard session history on this browser? Current sessions will remain. This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await send({ type: 'CLEAR_SESSION_HISTORY' });
      setHistory([]);
      setNotice('Ended session history cleared. Current sessions are unchanged.');
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };

  return <div className="console-stack">
    {error && <Notice tone="error">{error}</Notice>}
    {notice && <Notice>{notice}</Notice>}
    <Notice>Sessions are local, tab-scoped observations, not a verified inventory of AI products. Timeline labels distinguish observed facts, inferences, verified facts and policy outcomes. Scores are heuristic support, not probabilities.</Notice>
    <section className="console-panel" aria-label="Current sessions"><div className="panel-header"><div><h2>Current sessions</h2><p>Current tab coverage overrides earlier session states. Refresh data reads stored monitoring results only.</p></div><button className="button button-outline" disabled={busy} onClick={() => void exportSessions()}>Export session JSON</button></div>
      {sessions.length ? <div className="session-list">{sessions.map((session) => <SessionCard key={session.id} session={session} state={currentState(session, currentTabs, now)} historical={false} />)}</div> : <p className="muted">No current automation observation sessions.</p>}
    </section>
    <section className="console-panel" aria-label="Session history"><div className="panel-header"><div><h2>Ended session history</h2><p>{retention.maxHistorySessions === 0 ? 'Ended-session history retention is disabled.' : `Retained locally for up to ${retention.sessionRetentionDays} days, limited to ${retention.maxHistorySessions} ended sessions.`} History is not current control evidence.</p></div><div className="panel-actions"><button className="button button-outline" disabled={busy} onClick={() => void loadHistory()}>Refresh history</button><button className="button button-danger" disabled={busy || !history?.length} onClick={() => void clearHistory()}>Clear ended history</button></div></div>
      {history === null ? <p className="muted">{busy ? 'Loading session history…' : 'Session history is unavailable.'}</p> : history.length ? <div className="session-list">{history.map((session) => <SessionCard key={session.id} session={session} state={session.controlState} historical />)}</div> : <p className="muted">No ended session history retained.</p>}
    </section>
  </div>;
}
