import type { ReactNode } from 'react';
import type { DetectorCoverage, TabAgentStatus, TabState } from '../shared/contracts';
import { scoreText, stateCopy, timeText } from './client';
import { useCurrentAssessments } from './freshness';

export function Brand({ section }: { section: string }) {
  return <div className="brand"><div className="brand-mark" aria-hidden="true">AG</div><div><div className="brand-name">AgentGuard</div><div className="brand-section">{section}</div></div></div>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'warning' }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function StatusPill({ status }: { status: TabState }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}><span className="status-dot" aria-hidden="true" />{stateCopy[status].label}</span>;
}

export function Score({ value }: { value: number }) {
  return <div className="score"><div><span className="eyebrow">Evidence score</span><strong>{scoreText(value)}</strong></div><div className="score-track" role="meter" aria-label="Heuristic evidence score" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div><p>Heuristic support, not a probability of AI control.</p></div>;
}

function CoverageRow({ item }: { item: DetectorCoverage }) {
  const label = item.detector === 'debugger' ? 'Debugger' : item.detector === 'fingerprint' ? 'Fingerprint' : item.detector === 'webdriver' ? 'WebDriver' : 'Behavior';
  return <li><span>{label}</span><span className={`coverage-${item.availability}`}>{item.availability}</span><small>{item.reason}</small></li>;
}

export function TabAssessment({ assessment: observed }: { assessment: TabAgentStatus }) {
  const assessment = useCurrentAssessments([observed])[0]!;
  return <>
    {assessment !== observed && <Notice tone="warning">Assessment expired. Waiting for automatic monitoring to refresh the evidence.</Notice>}
    <section className={`assessment assessment-${assessment.status.toLowerCase()}`} aria-label="Current tab assessment">
      <div className="assessment-top"><span className="eyebrow">Current tab · {assessment.domain ?? 'Domain unavailable'}</span><StatusPill status={assessment.status} /></div>
      <h1>{stateCopy[assessment.status].label}</h1>
      <p>{stateCopy[assessment.status].detail}</p>
      <Score value={assessment.confidence} />
      <div className="assessment-meta"><span>Specific agent</span><strong>{assessment.identifiedAgent ?? 'Not identified'}</strong></div>
      {assessment.frameworkHints.length > 0 && <p className="hint">Unverified framework hints: {assessment.frameworkHints.join(', ')}</p>}
    </section>
    <section className="panel"><div className="section-heading"><h2>Supporting evidence</h2><span>{assessment.evidence.length}</span></div>
      {assessment.evidence.length === 0 ? <p className="muted">No positive automation evidence in this assessment.</p> : <ul className="evidence-list">{assessment.evidence.map((item, index) => <li key={`${item.detector}-${item.observedAt}-${index}`}><div><strong>{item.detector}</strong><span>{scoreText(item.confidence)}</span></div><p>{item.description}</p><small>Observed {timeText(item.observedAt)}</small></li>)}</ul>}
    </section>
    <section className="panel"><div className="section-heading"><h2>Detection coverage</h2><span>{assessment.coverage.filter((item) => item.availability === 'available').length}/{assessment.coverage.length} available</span></div>
      <ul className="coverage-list">{assessment.coverage.map((item) => <CoverageRow key={item.detector} item={item} />)}</ul>
      <p className="muted small">Last assessed {timeText(assessment.assessedAt)}. Evidence expires; missing coverage never means safe.</p>
    </section>
    <section className="panel policy-panel"><div className="section-heading"><h2>Policy</h2><span className={`action-${assessment.policy.action}`}>{assessment.policy.action}</span></div><p>{assessment.policy.reason}</p>{assessment.policy.matchedDomain && <small>Matched domain: {assessment.policy.matchedDomain}</small>}</section>
  </>;
}
