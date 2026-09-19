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
    if (sample.syntheticEvents >= 5) evidence.push({
      detector: 'behavior',
      family: 'behavior',
      confidence: 0.16,
      description: 'Several script-dispatched interactions were observed; page scripts may also cause them.',
      metadata: { signal: 'automation-indicator', bucket: 'synthetic-interactions' },
      observedAt: context.now,
      expiresAt: context.now + 60_000,
    });
    if (sample.intervalSamples >= 8 && sample.meanIntervalMs <= 250 && sample.intervalVariance <= 1_600) evidence.push({
      detector: 'behavior',
      family: 'behavior',
      confidence: 0.18,
      description: 'Interaction timing was unusually regular; this is weak and not specific to automation.',
      metadata: { signal: 'automation-indicator', bucket: 'regular-timing' },
      observedAt: context.now,
      expiresAt: context.now + 60_000,
    });
    if (sample.lastTrustedAt !== null && context.now - sample.lastTrustedAt <= 30_000) evidence.push({
      detector: 'behavior',
      family: 'behavior',
      confidence: 0.5,
      description: 'Recent browser-generated interaction was observed; this does not prove a person was present.',
      metadata: { signal: 'trusted-activity' },
      observedAt: sample.lastTrustedAt,
      expiresAt: sample.lastTrustedAt + 30_000,
    });
    return { evidence, coverage: { detector: 'behavior', availability: 'available', reason: 'Coarse interactions checked' } };
  },
};
