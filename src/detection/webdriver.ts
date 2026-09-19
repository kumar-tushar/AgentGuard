import type { Detector } from '../shared/contracts';

export const webdriverDetector: Detector = {
  id: 'webdriver',
  family: 'runtime',
  detect(context) {
    if (context.runtime?.webdriver === null || !context.runtime) {
      return { evidence: [], coverage: { detector: 'webdriver', availability: 'unavailable', reason: 'Runtime probe unavailable or WebDriver flag unreadable' } };
    }
    return {
      evidence: context.runtime.webdriver ? [{
        detector: 'webdriver',
        family: 'runtime',
        confidence: 0.82,
        description: 'The browser reports WebDriver remote control; this does not identify an AI agent.',
        metadata: { signal: 'automation-indicator', webdriver: true },
        observedAt: context.now,
        expiresAt: context.now + 90_000,
      }] : [],
      coverage: { detector: 'webdriver', availability: 'available', reason: 'WebDriver flag checked' },
    };
  },
};
