import type { DetectionEvidence } from '../shared/contracts';

const markerHints: Readonly<Record<string, string>> = {
  'playwright-binding': 'Playwright-like marker',
  'playwright-init': 'Playwright-like marker',
  'selenium-global': 'Selenium-like marker',
  'webdriver-global': 'WebDriver-like marker',
};

/** Framework traces are not agent identity. Verified identity needs a future authenticated integration. */
export function identifyAgent(evidence: readonly DetectionEvidence[]): { identifiedAgent: null; frameworkHints: string[] } {
  const frameworkHints = [...new Set(evidence
    .filter((item) => item.detector === 'fingerprint')
    .map((item) => markerHints[String(item.metadata.marker)])
    .filter((hint): hint is string => Boolean(hint)))].sort();
  return { identifiedAgent: null, frameworkHints };
}
