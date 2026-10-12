import type { DetectionEvidence } from '../shared/contracts';
import { fingerprintDefinition } from '../shared/fingerprints';

/** Framework traces are not agent identity. Verified identity needs a future authenticated integration. */
export function identifyAgent(evidence: readonly DetectionEvidence[]): { identifiedAgent: null; frameworkHints: string[] } {
  const frameworkHints = [...new Set(evidence
    .filter((item) => item.detector === 'fingerprint')
    .map((item) => fingerprintDefinition(item.metadata.marker)?.hint)
    .filter((hint): hint is string => Boolean(hint)))].sort();
  return { identifiedAgent: null, frameworkHints };
}
