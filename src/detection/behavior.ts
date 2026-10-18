import type { DetectionEvidence, Detector } from '../shared/contracts';

export const behaviorDetector: Detector = {
  id: 'behavior',
  family: 'behavior',
  detect(context) {
    const sample = context.behavior;
    if (!sample) {
      return { evidence: [], coverage: { detector: 'behavior', availability: 'unavailable', reason: 'Behavior collection unavailable or stale' } };
    }
    const evidence: DetectionEvidence[] = [];
    if (sample.lastTrustedAt !== null && context.now - sample.lastTrustedAt <= 30_000) evidence.push({
      detector: 'behavior',
      family: 'behavior',
      confidence: 0.5,
      description: 'Recent browser-generated interaction was observed; this does not prove a person was present.',
      metadata: { signal: 'trusted-activity' },
      observedAt: sample.lastTrustedAt,
      expiresAt: sample.lastTrustedAt + 30_000,
    });
    return { evidence, coverage: { detector: 'behavior', availability: 'available', reason: 'Activity context only; not automation evidence' } };
  },
};
