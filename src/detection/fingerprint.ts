import type { DetectionEvidence, Detector, Fingerprint } from '../shared/contracts';

const descriptions: Record<Fingerprint, string> = {
  'playwright-binding': 'A Playwright-like binding exists in the page world; it is an unverified framework hint.',
  'playwright-init': 'A Playwright-like initialization marker exists in the page world; it is an unverified framework hint.',
  'selenium-global': 'A Selenium-like global exists in the page world; it is an unverified framework hint.',
  'webdriver-global': 'A WebDriver-like global exists in the page world; it is an unverified framework hint.',
};
const weights: Record<Fingerprint, number> = {
  'playwright-binding': 0.34,
  'playwright-init': 0.28,
  'selenium-global': 0.28,
  'webdriver-global': 0.25,
};

export const fingerprintDetector: Detector = {
  id: 'fingerprint',
  family: 'runtime',
  detect(context) {
    if (!context.runtime) {
      return { evidence: [], coverage: { detector: 'fingerprint', availability: 'unavailable', reason: 'Runtime probe unavailable' } };
    }
    const evidence: DetectionEvidence[] = context.runtime.fingerprints.map(marker => ({
      detector: 'fingerprint',
      family: 'runtime',
      confidence: weights[marker],
      description: descriptions[marker],
      metadata: { signal: 'automation-indicator', marker },
      observedAt: context.now,
      expiresAt: context.now + 90_000,
    }));
    return { evidence, coverage: { detector: 'fingerprint', availability: 'available', reason: 'Allowlisted runtime markers checked' } };
  },
};
