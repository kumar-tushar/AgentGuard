import type { DetectionEvidence, Detector } from '../shared/contracts';
import { FINGERPRINT_REGISTRY } from '../shared/fingerprints';

export const fingerprintDetector: Detector = {
  id: 'fingerprint',
  family: 'runtime',
  detect(context) {
    if (!context.runtime || context.runtime.fingerprints === null) {
      return { evidence: [], coverage: { detector: 'fingerprint', availability: 'unavailable', reason: 'Runtime probe unavailable' } };
    }
    const evidence: DetectionEvidence[] = context.runtime.fingerprints.map(marker => ({
      detector: 'fingerprint',
      family: 'runtime',
      confidence: FINGERPRINT_REGISTRY[marker].confidence,
      description: FINGERPRINT_REGISTRY[marker].description,
      metadata: { signal: 'automation-indicator', marker },
      observedAt: context.now,
      expiresAt: context.now + 90_000,
    }));
    return { evidence, coverage: { detector: 'fingerprint', availability: 'available', reason: 'Allowlisted runtime markers checked' } };
  },
};
