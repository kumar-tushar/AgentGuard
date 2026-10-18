import type { DetectionEvidence, TabAgentStatus } from '../shared/contracts';

/** Activity, timing and synthetic DOM events never establish browser automation. */
export function isAutomationEvidence(evidence: Readonly<DetectionEvidence>): boolean {
  return evidence.metadata.signal === 'automation-indicator' && (
    ((evidence.detector === 'webdriver' || evidence.detector === 'fingerprint') && evidence.family === 'runtime') ||
    (evidence.detector === 'debugger' && evidence.family === 'debugger')
  );
}

/** Activity context can expire independently without changing the control assessment. */
export function assessmentDeadline(assessment: Pick<TabAgentStatus, 'evidence' | 'expiresAt'>): number {
  return Math.min(assessment.expiresAt, ...assessment.evidence
    .filter(item => item.detector !== 'behavior' && item.family !== 'behavior').map(item => item.expiresAt));
}
