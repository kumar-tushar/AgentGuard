import { useState } from 'react';
import type { BrowserStatistics, SessionSummaryReport } from '../shared/reports';
import { errorText, scoreText, send, timeText } from './client';
import { Notice } from './components';

export function MonitoringSummary({ statistics }: { statistics: BrowserStatistics | undefined }) {
  if (!statistics) return null;
  return <section className="panel" aria-label="Monitoring summary"><h2>Monitoring summary</h2>
    <dl className="session-counts"><div><dt>Observation sessions</dt><dd>{statistics.sessionsObserved}</dd></div><div><dt>Confirmed tab containments</dt><dd>{statistics.confirmedContainments}</dd></div></dl>
    <p className="muted small">Since {timeText(statistics.firstSessionAt)}. Counts describe local observations, not distinct AI controllers. Repeated detections within a session do not create new sessions.</p>
    {Object.keys(statistics.frameworks).length > 0 && <p className="muted small">Framework hints: {Object.entries(statistics.frameworks).map(([framework, count]) => `${framework}: ${count}`).join(' · ')}. Unverified tooling hints only.</p>}
  </section>;
}

export function SessionReportButton({ sessionId }: { sessionId: string }) {
  const [report, setReport] = useState<SessionSummaryReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setBusy(true); setError(null);
    try { setReport(await send({ type: 'GET_SESSION_REPORT', sessionId })); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const exportReport = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `agentguard-report-${report.sessionId}.json`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  return <div className="session-details">
    <button className="button button-outline" disabled={busy} onClick={() => report ? setReport(null) : void load()}>{busy ? 'Loading report…' : report ? 'Hide report' : 'View report'}</button>
    {error && <Notice tone="error">{error}</Notice>}
    {report && <section aria-label="Session report"><h4>Session report</h4>
      <dl className="session-facts"><div><dt>Domain</dt><dd>{report.domain ?? 'Unavailable'}</dd></div><div><dt>Controller</dt><dd>Unknown</dd></div><div><dt>Observation duration</dt><dd>{Math.floor(report.observedDurationMs / 1000)} seconds</dd></div><div><dt>Evidence support</dt><dd>{scoreText(report.controlScore)}</dd></div><div><dt>Coverage score</dt><dd>{scoreText(report.coverageScore)}</dd></div><div><dt>Retained timeline events</dt><dd>{report.timelineEvents}</dd></div><div><dt>Retained boundary-violation events (incomplete coverage)</dt><dd>{report.boundaryViolations}</dd></div></dl>
      <p className="muted small">{report.coverageNote}</p>
      <button className="button button-outline" onClick={exportReport}>Export report JSON</button>
    </section>}
  </div>;
}
