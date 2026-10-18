import type { DetectionContext, DetectionEvidence, DetectorCoverage, SignalFamily, TabState } from '../shared/contracts';
import { identifyAgent } from './identity';
import { isAutomationEvidence } from './evidence';

export interface ScoredAssessment {
  status: TabState;
  confidence: number;
  evidence: DetectionEvidence[];
  coverage: DetectorCoverage[];
  identifiedAgent: null;
  frameworkHints: string[];
}

/** Pure, deliberately conservative heuristic. Scores are not probabilities. */
export function scoreAssessment(
  context: Readonly<DetectionContext>,
  evidence: readonly DetectionEvidence[],
  coverage: readonly DetectorCoverage[],
): ScoredAssessment {
  const current = evidence.filter(item =>
    ['runtime', 'debugger', 'behavior'].includes(item.family) &&
    Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1 &&
    Number.isFinite(item.observedAt) && item.observedAt <= context.now &&
    Number.isFinite(item.expiresAt) && item.expiresAt > context.now,
  ).filter(item => isAutomationEvidence(item) ||
    (item.detector === 'behavior' && item.family === 'behavior' && item.metadata.signal === 'trusted-activity'));
  const automation = current.filter(isAutomationEvidence);
  const familyMaximums: Record<SignalFamily, number> = { runtime: 0, debugger: 0, behavior: 0 };
  for (const item of automation) familyMaximums[item.family] = Math.max(familyMaximums[item.family], item.confidence);
  const combined = 1 - Object.values(familyMaximums).reduce((remaining, score) => remaining * (1 - score), 1);
  const risk = Math.min(0.99, Math.max(0, Math.round(combined * 10_000) / 10_000));
  const webdriver = automation.some(item => item.detector === 'webdriver' && item.metadata.webdriver === true && item.confidence >= 0.8);
  const debuggerAttached = automation.some(item => item.detector === 'debugger' && item.metadata.attached === true && item.confidence >= 0.35);
  const runtimeAvailable = ['webdriver', 'fingerprint'].every(detector =>
    coverage.some(item => item.detector === detector && item.availability === 'available'));
  const debuggerAvailable = coverage.some(item => item.detector === 'debugger' && item.availability === 'available');

  let status: TabState = 'UNMONITORED';
  let confidence = risk;
  if (webdriver || (debuggerAttached && risk >= 0.75)) status = 'AUTOMATION_LIKELY';
  else if (risk > 0) status = 'AUTOMATION_SUSPECTED';
  else if (runtimeAvailable && debuggerAvailable) {
    status = 'NO_AUTOMATION_OBSERVED';
    confidence = 0;
  }

  return {
    status,
    confidence,
    evidence: current,
    coverage: [...coverage],
    ...identifyAgent(current),
  };
}
