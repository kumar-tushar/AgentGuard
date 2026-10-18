import type { Fingerprint } from './contracts';
import type { Framework } from './intelligence';

/** Packaged research provenance, never a remotely updated or page-provided registry. */
export const FINGERPRINT_REGISTRY_VERSION = 1;
export interface FingerprintProbe {
  readonly id: Fingerprint;
  readonly ownGlobals: readonly string[];
}
export interface FingerprintDefinition {
  readonly id: Fingerprint;
  readonly framework: Framework;
  /** Framework maintainer only; never the observed controller's vendor. */
  readonly vendor: string | null;
  readonly signal: FingerprintProbe;
  readonly reliability: 'unverified-framework-hint';
  readonly confidence: number;
  readonly description: string;
  readonly hint: string;
  readonly versionConstraints: string;
  readonly testFixture: string;
  readonly falsePositiveNotes: string;
  readonly lastVerifiedDate: string | null;
  readonly sources: readonly string[];
}

const falsePositiveNotes = 'A page can forge or retain this property; authorized test tooling can expose it. Existence does not identify an AI product or prove current control.';
const legacyVersions = 'Legacy compatibility marker; no supported framework-version range or real-tool verification established.';

export const FINGERPRINT_REGISTRY = {
  'playwright-binding': {
    id: 'playwright-binding', framework: 'Playwright-like', vendor: 'Microsoft',
    signal: { id: 'playwright-binding', ownGlobals: ['__playwright__binding__', '__playwright__binding__controller__'] },
    reliability: 'unverified-framework-hint', confidence: 0.34,
    description: 'A Playwright-like binding exists in the page world; it is an unverified framework hint.',
    hint: 'Playwright-like marker',
    versionConstraints: 'Source inspected in installed Playwright 1.63.0; presence depends on exposed bindings. Other versions/configurations are not guaranteed.',
    testFixture: 'tests/e2e/extension.spec.ts: real Playwright binding registry fixture',
    falsePositiveNotes, lastVerifiedDate: '2026-09-26',
    sources: ['https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/page.ts',
      'https://github.com/microsoft/playwright/blob/main/packages/isomorphic/utilityScriptSerializers.ts'],
  },
  'playwright-init': {
    id: 'playwright-init', framework: 'Playwright-like', vendor: 'Microsoft',
    signal: { id: 'playwright-init', ownGlobals: ['__pwInitScripts'] },
    reliability: 'unverified-framework-hint', confidence: 0.28,
    description: 'A Playwright-like initialization marker exists in the page world; it is an unverified framework hint.',
    hint: 'Playwright-like marker', versionConstraints: legacyVersions,
    testFixture: 'tests/probes.test.ts: registry property fixtures (synthetic only)',
    falsePositiveNotes, lastVerifiedDate: null, sources: [],
  },
  'selenium-global': {
    id: 'selenium-global', framework: 'Selenium-like', vendor: 'Selenium project',
    signal: { id: 'selenium-global', ownGlobals: ['__selenium_unwrapped', '__selenium_evaluate'] },
    reliability: 'unverified-framework-hint', confidence: 0.28,
    description: 'A Selenium-like global exists in the page world; it is an unverified framework hint.',
    hint: 'Selenium-like marker', versionConstraints: legacyVersions,
    testFixture: 'tests/probes.test.ts: registry property fixtures (synthetic only)',
    falsePositiveNotes, lastVerifiedDate: null, sources: [],
  },
  'webdriver-global': {
    id: 'webdriver-global', framework: 'WebDriver-compatible', vendor: null,
    signal: { id: 'webdriver-global', ownGlobals: ['__webdriver_evaluate', '__webdriver_script_fn'] },
    reliability: 'unverified-framework-hint', confidence: 0.25,
    description: 'A WebDriver-like global exists in the page world; it is an unverified framework hint.',
    hint: 'WebDriver-like marker', versionConstraints: legacyVersions,
    testFixture: 'tests/probes.test.ts: registry property fixtures (synthetic only)',
    falsePositiveNotes, lastVerifiedDate: null, sources: [],
  },
  'playwright-stack': {
    id: 'playwright-stack', framework: 'Playwright-like', vendor: 'Microsoft',
    signal: { id: 'playwright-stack', ownGlobals: [] }, reliability: 'unverified-framework-hint', confidence: 0.36,
    description: 'A selected page API call had a Playwright utility-script stack pattern; this is spoofable and does not identify a controller.',
    hint: 'Playwright-like call stack', versionConstraints: 'Opt-in selected API interception only. Real fixture uses installed Playwright 1.63.0; other versions and native input are not guaranteed.',
    testFixture: 'tests/e2e/extension.spec.ts: opt-in stack hints fixture', falsePositiveNotes, lastVerifiedDate: '2026-10-16',
    sources: ['https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/injected/utilityScript.ts'],
  },
  'puppeteer-stack': {
    id: 'puppeteer-stack', framework: 'Puppeteer-like', vendor: 'Puppeteer project',
    signal: { id: 'puppeteer-stack', ownGlobals: [] }, reliability: 'unverified-framework-hint', confidence: 0.34,
    description: 'A selected page API call had a Puppeteer evaluation stack pattern; this is spoofable and does not identify a controller.',
    hint: 'Puppeteer-like call stack', versionConstraints: 'Synthetic source-label fixtures only; no real Puppeteer version matrix established.',
    testFixture: 'tests/stack.test.ts: serialized stack probe fixtures', falsePositiveNotes, lastVerifiedDate: null, sources: [],
  },
} as const satisfies Readonly<Record<Fingerprint, FingerprintDefinition>>;

export const FINGERPRINT_PROBES: readonly FingerprintProbe[] = Object.values(FINGERPRINT_REGISTRY).map(item => item.signal);

export function fingerprintDefinition(id: unknown): FingerprintDefinition | undefined {
  return typeof id === 'string' && Object.hasOwn(FINGERPRINT_REGISTRY, id)
    ? FINGERPRINT_REGISTRY[id as Fingerprint] : undefined;
}
