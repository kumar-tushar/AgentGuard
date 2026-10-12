import { describe, expect, it } from 'vitest';
import type { DetectionContext, DetectionEvidence, Detector } from '../src/shared/contracts';
import { assess } from '../src/detection/engine';
import { scoreAssessment } from '../src/detection/scoring';
import { normalizeBehaviorSnapshot, normalizeRuntimeSnapshot } from '../src/detection/validation';

const NOW = 1_800_000_000_000;

function context(overrides: Partial<DetectionContext> = {}): DetectionContext {
  return {
    now: NOW,
    runtime: { webdriver: false, fingerprints: [] },
    behavior: null,
    debuggerAttached: null,
    runtimeReason: '',
    debuggerReason: '',
    ...overrides,
  };
}

describe('probe normalization', () => {
  it('rebuilds exact, allowlisted runtime results', () => {
    expect(normalizeRuntimeSnapshot({ webdriver: true, fingerprints: ['playwright-binding'] })).toEqual({
      webdriver: true, fingerprints: ['playwright-binding'],
    });
    expect(normalizeRuntimeSnapshot({ webdriver: true, fingerprints: ['made-up'] })).toBeNull();
    expect(normalizeRuntimeSnapshot({ webdriver: true, fingerprints: [], password: 'secret' })).toBeNull();
    expect(normalizeRuntimeSnapshot({ webdriver: false, fingerprints: ['playwright-binding', 'playwright-binding'] })).toBeNull();
  });

  it('rejects malformed, overflowing, and stale behavior aggregates', () => {
    const valid = {
      trustedEvents: 1, syntheticEvents: 0, intervalSamples: 0,
      meanIntervalMs: 0, intervalVariance: 0, lastTrustedAt: NOW - 1000, startedAt: NOW - 3000,
    };
    expect(normalizeBehaviorSnapshot(valid, NOW)).toEqual(valid);
    expect(normalizeBehaviorSnapshot({ ...valid, trustedEvents: 65 }, NOW)).toBeNull();
    expect(normalizeBehaviorSnapshot({ ...valid, lastTrustedAt: NOW - 61_000 }, NOW)).toBeNull();
    expect(normalizeBehaviorSnapshot({ ...valid, target: 'password' }, NOW)).toBeNull();
    expect(normalizeBehaviorSnapshot({ ...valid, intervalVariance: Number.POSITIVE_INFINITY }, NOW)).toBeNull();
  });
});

describe('detector engine and status semantics', () => {
  it('correlates independent WebDriver and debugger signals without inventing active control', async () => {
    const result = await assess(context({ runtime: { webdriver: true, fingerprints: [] }, debuggerAttached: true }));
    expect(result.status).toBe('AUTOMATION_LIKELY');
    expect(result.confidence).toBe(0.8884);
    expect(result.identifiedAgent).toBeNull();
    expect(result.evidence.map(item => item.detector)).toEqual(['webdriver', 'debugger']);
  });

  it('distinguishes a strong WebDriver flag from an ambiguous debugger attachment', async () => {
    const webdriver = await assess(context({ runtime: { webdriver: true, fingerprints: [] } }));
    const debuggerOnly = await assess(context({ debuggerAttached: true }));
    expect(webdriver.status).toBe('AUTOMATION_LIKELY');
    expect(webdriver.confidence).toBe(0.82);
    expect(debuggerOnly.status).toBe('AUTOMATION_SUSPECTED');
    expect(debuggerOnly.confidence).toBe(0.38);
    expect(debuggerOnly.identifiedAgent).toBeNull();
  });

  it('deduplicates correlated runtime markers and keeps names as unverified hints', async () => {
    const result = await assess(context({
      runtime: { webdriver: false, fingerprints: ['playwright-binding', 'playwright-init', 'selenium-global'] },
      debuggerAttached: true,
    }));
    expect(result.status).toBe('AUTOMATION_SUSPECTED');
    expect(result.confidence).toBe(0.5908);
    expect(result.frameworkHints).toEqual(['Playwright-like marker', 'Selenium-like marker']);
    expect(result.identifiedAgent).toBeNull();
  });

  it('keeps behavior anomalies alone at weak suspicion, never likely or active', async () => {
    const result = await assess(context({ behavior: {
      trustedEvents: 0, syntheticEvents: 10, intervalSamples: 9,
      meanIntervalMs: 100, intervalVariance: 100, lastTrustedAt: null, startedAt: NOW - 1000,
    } }));
    expect(result.status).toBe('AUTOMATION_SUSPECTED');
    expect(result.confidence).toBe(0.18);
    expect(result.evidence).toHaveLength(2);
  });

  it('requires coverage for NO_AUTOMATION_OBSERVED and never interprets trusted activity as human control', async () => {
    const behavior = {
      trustedEvents: 1, syntheticEvents: 0, intervalSamples: 0,
      meanIntervalMs: 0, intervalVariance: 0, lastTrustedAt: NOW - 1000, startedAt: NOW - 3000,
    };
    const observed = await assess(context({ behavior, debuggerAttached: false }));
    expect(observed.status).toBe('NO_AUTOMATION_OBSERVED');
    expect(observed.confidence).toBe(0);
    expect(observed.evidence[0]?.metadata.signal).toBe('trusted-activity');
    expect((await assess(context({ runtime: null, behavior, debuggerAttached: false }))).status).toBe('UNMONITORED');
    const staleActivity = await assess(context({ behavior: { ...behavior, lastTrustedAt: NOW - 31_000 }, debuggerAttached: false }));
    expect(staleActivity.status).toBe('NO_AUTOMATION_OBSERVED');
    expect(staleActivity.evidence).toEqual([]);
    expect((await assess(context({ runtime: { webdriver: false, fingerprints: [] }, debuggerAttached: false }))).status).toBe('NO_AUTOMATION_OBSERVED');
    const unavailable = await assess(context({ behavior, debuggerReason: 'Debugger access restricted by organization policy' }));
    expect(unavailable.status).toBe('UNMONITORED');
    expect(unavailable.confidence).toBe(0);
    expect(unavailable.coverage.find(item => item.detector === 'debugger')).toEqual({
      detector: 'debugger', availability: 'unavailable', reason: 'Debugger access restricted by organization policy',
    });
  });

  it('treats malformed runtime output as lost coverage, not as a negative result', async () => {
    const result = await assess(context({ runtime: { webdriver: false, fingerprints: ['unknown'] } as never }));
    expect(result.status).toBe('UNMONITORED');
    expect(result.coverage.find(item => item.detector === 'webdriver')?.availability).toBe('unavailable');
  });

  it('isolates failed fingerprint inspection from WebDriver and never calls incomplete negative coverage clear', async () => {
    const positive = await assess(context({ runtime: { webdriver: true, fingerprints: null }, debuggerAttached: false }));
    expect(positive.status).toBe('AUTOMATION_LIKELY');
    expect(positive.confidence).toBe(0.82);
    expect(positive.coverage.find(item => item.detector === 'fingerprint')?.availability).toBe('unavailable');
    expect(positive.coverage.find(item => item.detector === 'webdriver')?.availability).toBe('available');
    expect(positive.identifiedAgent).toBeNull();
    const negative = await assess(context({ runtime: { webdriver: false, fingerprints: null }, debuggerAttached: false }));
    expect(negative.status).toBe('UNMONITORED');
  });

  it('discards expired evidence', () => {
    const expired: DetectionEvidence = {
      detector: 'webdriver', family: 'runtime', confidence: 0.82,
      description: 'expired', metadata: { signal: 'automation-indicator', webdriver: true },
      observedAt: NOW - 100_000, expiresAt: NOW - 1,
    };
    expect(scoreAssessment(context(), [expired], []).status).toBe('UNMONITORED');
  });

  it('does not promote a nominal zero-strength debugger flag through behavior', () => {
    const evidence: DetectionEvidence[] = [
      { detector: 'webdriver', family: 'runtime', confidence: 0.82, description: 'flag', metadata: { signal: 'automation-indicator', webdriver: true }, observedAt: NOW, expiresAt: NOW + 1000 },
      { detector: 'debugger', family: 'debugger', confidence: 0, description: 'flag', metadata: { signal: 'automation-indicator', attached: true }, observedAt: NOW, expiresAt: NOW + 1000 },
      { detector: 'behavior', family: 'behavior', confidence: 0.18, description: 'timing', metadata: { signal: 'automation-indicator' }, observedAt: NOW, expiresAt: NOW + 1000 },
    ];
    expect(scoreAssessment(context(), evidence, []).status).toBe('AUTOMATION_LIKELY');
  });

  it('isolates detector failures and timeouts without suppressing other evidence', async () => {
    const failed: Detector = {
      id: 'fingerprint', family: 'runtime',
      detect: () => { throw new Error('page secret must never surface'); },
    };
    const hung: Detector = {
      id: 'behavior', family: 'behavior',
      detect: () => new Promise(() => undefined),
    };
    const valid: Detector = {
      id: 'webdriver', family: 'runtime',
      detect: () => ({
        evidence: [{ detector: 'webdriver', family: 'runtime', confidence: 0.82,
          description: 'WebDriver flag', metadata: { signal: 'automation-indicator', webdriver: true },
          observedAt: NOW, expiresAt: NOW + 1000 }],
        coverage: { detector: 'webdriver', availability: 'available', reason: 'checked' },
      }),
    };
    const result = await assess(context(), { detectors: [failed, hung, valid], timeoutMs: 10 });
    expect(result.status).toBe('AUTOMATION_LIKELY');
    expect(result.coverage.map(item => item.availability)).toEqual(['error', 'error', 'available']);
    expect(JSON.stringify(result)).not.toContain('page secret');
  });
});
