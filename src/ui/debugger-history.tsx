import { useEffect, useState } from 'react';
import type { DebuggerIntelligenceView, DebuggerTransitionType } from '../shared/intelligence';
import { timeText } from './client';

const labels: Record<DebuggerTransitionType, string> = {
  target_seen: 'Target observed', attachment_observed: 'Debugger attachment observed',
  detachment_observed: 'No attachment observed', target_disappeared: 'Target no longer listed',
  coverage_lost: 'Observation coverage lost', coverage_restored: 'Observation coverage restored',
};

export function DebuggerHistory({ view }: { view: DebuggerIntelligenceView }) {
  const [tick, setTick] = useState(Date.now);
  const now = Math.max(tick, Date.now());
  const expiresAt = Math.min(...[view.lastCapturedAt, ...view.targets.map(target => target.lastSeen)]
    .filter((time): time is number => time !== null).map(time => time + 90_000).filter(time => time > now));
  useEffect(() => {
    const timer = Number.isFinite(expiresAt) ? window.setTimeout(() => setTick(Date.now()), Math.max(0, expiresAt - Date.now())) : undefined;
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  const available = view.coverageAvailable && view.lastCapturedAt !== null && now >= view.lastCapturedAt && now - view.lastCapturedAt < 90_000;
  return <section className="console-panel" aria-label="Debugger observation history">
    <div className="panel-header"><div><h2>Debugger observations</h2><p>Passive samples, not a list of identified agents. Ordinary DevTools can produce the same attachment signal.</p></div></div>
    <p className="muted small">{available ? 'Recent target inspection available.' : 'Current target inspection unavailable or expired.'} Last capture: {timeText(view.lastCapturedAt)}. Attachment spans below measure time between samples, not exact connection duration.</p>
    {view.targets.length ? <div className="table-scroll"><table><thead><tr><th>Domain / target</th><th>Attachment observation</th><th>Controller</th><th>First / last seen</th><th>Sample span</th><th>Timeline</th></tr></thead><tbody>
      {view.targets.slice(0, 50).map(target => {
        const fresh = available && target.observationFresh && target.disappearedAt === null && now >= target.lastSeen && now - target.lastSeen < 90_000;
        return <tr key={target.targetId}><td>{target.domain ?? 'Domain unavailable'}<div className="table-detail">{target.type} · {target.tabId === null ? 'No associated tab' : `Tab ${target.tabId}`}</div><code>{target.targetId}</code></td>
          <td>{fresh && target.currentAttached !== null ? target.currentAttached ? 'Debugger attached' : 'No attachment observed' : 'Unavailable'}{target.disappearedAt !== null && <div className="table-detail">No longer listed at {timeText(target.disappearedAt)}</div>}</td>
          <td>Unknown</td><td>{timeText(target.firstSeen)}<br />{timeText(target.lastSeen)}</td><td>{Math.floor(target.sampledAttachmentSpanMs / 1000)} seconds (sampled)</td>
          <td><details><summary>Observation transitions</summary><ol>{target.timeline.map((event, index) => <li key={`${event.timestamp}-${index}`}>{timeText(event.timestamp)} · {labels[event.type]}</li>)}</ol></details></td></tr>;
      })}
    </tbody></table></div> : <p className="muted">No target observations retained.</p>}
    {view.targets.length > 50 && <p className="muted small">Showing 50 of {view.targets.length} retained target records. Older samples are not current control evidence.</p>}
  </section>;
}
