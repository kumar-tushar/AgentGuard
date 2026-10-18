import { describe, expect, it } from 'vitest';
import { toSessionObservation, type SessionActivity } from '../src/background/session-observation';
import { AgentSessionStore, SESSION_EVIDENCE_IDS } from '../src/background/agent-sessions';
import type { DetectionEvidence, TabAgentStatus } from '../src/shared/contracts';
import { emptyActivity, unknownIdentity } from '../src/shared/intelligence';

const NOW = 1_000_000;
function evidence(detector: DetectionEvidence['detector'], metadata: DetectionEvidence['metadata'], confidence = 0.5): DetectionEvidence {
  return { detector, family: detector === 'webdriver' || detector === 'fingerprint' ? 'runtime' : detector,
    confidence, description: 'Do not persist raw description', metadata, observedAt: NOW, expiresAt: NOW + 90_000 };
}
function status(patch: Partial<TabAgentStatus> = {}): TabAgentStatus {
  return {
    tabId: 1, domain: 'example.com', status: 'AUTOMATION_LIKELY', identifiedAgent: null, frameworkHints: [], confidence: 0.82,
    evidence: [evidence('webdriver', { signal: 'automation-indicator', webdriver: true }, 0.82)],
    coverage: [
      { detector: 'webdriver', availability: 'available', reason: 'Checked' },
      { detector: 'fingerprint', availability: 'available', reason: 'Checked' },
      { detector: 'debugger', availability: 'available', reason: 'Checked' },
      { detector: 'behavior', availability: 'unavailable', reason: 'Disabled' },
    ],
    firstDetectedAt: NOW, lastDetectedAt: NOW, assessedAt: NOW, expiresAt: NOW + 90_000,
    policy: { action: 'monitor', reason: 'Policy', matchedDomain: null }, ...patch,
  };
}

describe('session observation mapper', () => {
  it('maps WebDriver evidence without inferring activity or agent identity', () => {
    const result = toSessionObservation(status());
    expect(result).toEqual({ tabId: 1, domain: 'example.com', controlState: 'AUTOMATION_LIKELY', controller: unknownIdentity(),
      automationStack: { transports: ['WebDriver'], frameworks: [], environmentHints: [], controllerCandidates: [] },
      controlScore: 0.82, frameworkConfidence: 0, coverageScore: 0.75,
      evidenceIds: ['webdriver:webdriver'], observedAt: NOW, expiresAt: NOW + 90_000,
      lastActivityAt: null, activityDelta: emptyActivity() });
  });

  it('maps passive debugger attachment to CDP transport without declaring ACTIVE or CONNECTED', () => {
    const result = toSessionObservation(status({ status: 'AUTOMATION_SUSPECTED', confidence: 0.38,
      evidence: [evidence('debugger', { signal: 'automation-indicator', attached: true }, 0.38)] }));
    expect(result.controlState).toBe('AUTOMATION_SUSPECTED');
    expect(result.automationStack.transports).toEqual(['CDP']);
    expect(result.controller).toEqual(unknownIdentity());
    expect(result.evidenceIds).toEqual(['debugger:attached']);
  });

  it.each([
    ['playwright-binding', 'Playwright-like'], ['playwright-init', 'Playwright-like'],
    ['selenium-global', 'Selenium-like'], ['webdriver-global', 'WebDriver-compatible'],
  ])('maps %s to only the %s framework hint', (marker, framework) => {
    const result = toSessionObservation(status({ evidence: [evidence('fingerprint', { signal: 'automation-indicator', marker }, 0.34)] }));
    expect(result.automationStack.frameworks).toEqual([framework]);
    expect(result.automationStack.transports).toEqual([]);
    expect(result.frameworkConfidence).toBe(0.34);
    expect(result.controller).toEqual({ ...unknownIdentity(), attributionLevel: 'FRAMEWORK_ONLY', evidenceIds: [`fingerprint:${marker}`] });
  });

  it('deduplicates IDs/frameworks and uses maximum fingerprint confidence instead of correlated summation', () => {
    const binding = evidence('fingerprint', { signal: 'automation-indicator', marker: 'playwright-binding' }, 0.34);
    const result = toSessionObservation(status({ evidence: [binding, binding,
      evidence('fingerprint', { signal: 'automation-indicator', marker: 'playwright-init' }, 0.28),
      evidence('debugger', { signal: 'automation-indicator', attached: true }, 0.38)] }));
    expect(result.frameworkConfidence).toBe(0.34);
    expect(result.automationStack.frameworks).toEqual(['Playwright-like']);
    expect(result.evidenceIds).toEqual(['fingerprint:playwright-binding', 'fingerprint:playwright-init', 'debugger:attached']);
    expect(result.controller.confidence).toBe(0);
  });

  it('maps trusted activity as context without fabricating automation, counters or timestamps', () => {
    const result = toSessionObservation(status({
      status: 'NO_AUTOMATION_OBSERVED', confidence: 0, firstDetectedAt: null, lastDetectedAt: null,
      evidence: [evidence('behavior', { signal: 'trusted-activity' })],
      coverage: [{ detector: 'behavior', availability: 'available', reason: 'Observed' }],
    }));
    expect(result.evidenceIds).toEqual(['behavior:trusted-activity']);
    expect(result.controlState).toBe('NO_AUTOMATION_OBSERVED');
    expect(result.controlScore).toBe(0);
    expect(result.activityDelta).toEqual(emptyActivity());
    expect(result.lastActivityAt).toBeNull();
    expect(result.automationStack.transports).toEqual([]);
  });

  it.each(['synthetic-interactions', 'regular-timing'])('rejects retired %s evidence as a live automation observation', bucket => {
    expect(() => toSessionObservation(status({ status: 'AUTOMATION_SUSPECTED', confidence: 0.18,
      evidence: [evidence('behavior', { signal: 'automation-indicator', bucket }, 0.18)],
      coverage: [{ detector: 'behavior', availability: 'available', reason: 'Observed' }],
    }))).toThrow('Invalid session observation source');
  });

  it('uses worker-supplied document-bound deltas without promoting the control state', () => {
    const input = { activityDelta: { ...emptyActivity(), navigations: 1, pointerInteractions: 3 }, lastActivityAt: NOW - 1 };
    const result = toSessionObservation(status(), input);
    expect(result.activityDelta).toEqual(input.activityDelta);
    expect(result.lastActivityAt).toBe(NOW - 1);
    expect(result.controlState).toBe('AUTOMATION_LIKELY');
    input.activityDelta.pointerInteractions = 900;
    expect(result.activityDelta.pointerInteractions).toBe(3);
  });

  it.each(['NO_AUTOMATION_OBSERVED', 'UNMONITORED'] as const)('preserves %s without creating positive evidence', controlState => {
    const result = toSessionObservation(status({ status: controlState, confidence: 0, evidence: [],
      coverage: [], firstDetectedAt: null, lastDetectedAt: null }));
    expect(result.controlState).toBe(controlState);
    expect(result.evidenceIds).toEqual([]);
    expect(result.coverageScore).toBe(0);
    expect(result.controller).toEqual(unknownIdentity());
    expect(result.activityDelta).toEqual(emptyActivity());
  });

  it('caps observation expiry at both the assessment expiry and the earliest supporting evidence expiry', () => {
    const earlier = { ...status().evidence[0]!, expiresAt: NOW + 10_000 };
    expect(toSessionObservation(status({ expiresAt: NOW + 20_000, evidence: [earlier] })).expiresAt).toBe(NOW + 10_000);
    expect(toSessionObservation(status({ expiresAt: NOW + 5_000, evidence: [earlier] })).expiresAt).toBe(NOW + 5_000);
  });

  it('does not shorten a control session when activity context expires earlier', () => {
    const input = status();
    input.coverage = input.coverage.map(item => ({ ...item, availability: 'available' }));
    input.evidence.push({ ...evidence('behavior', { signal: 'trusted-activity' }), expiresAt: NOW + 30_000 });
    expect(toSessionObservation(input).expiresAt).toBe(NOW + 90_000);
  });

  it('derives coverage from available detector entries and treats errors as missing coverage', () => {
    const input = status();
    input.coverage[1]!.availability = 'error';
    expect(toSessionObservation(input).coverageScore).toBe(0.5);
    expect(toSessionObservation(status({ status: 'UNMONITORED', confidence: 0, evidence: [],
      coverage: [{ detector: 'debugger', availability: 'unavailable', reason: 'Denied by policy' }] })).coverageScore).toBe(0);
  });

  it('never copies raw descriptions, identity claims, framework labels, policy text, URLs or arbitrary fields', () => {
    const input = status({ identifiedAgent: 'SECRET controller', frameworkHints: ['SECRET framework'],
      policy: { action: 'warn', reason: 'SECRET password', matchedDomain: 'SECRET domain' } });
    input.evidence[0]!.description = 'https://example.com/private?token=SECRET';
    input.coverage[0]!.reason = 'SECRET cookie';
    const result = toSessionObservation({ ...input, url: 'SECRET URL', token: 'SECRET token' } as TabAgentStatus);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('https://');
    expect(result.controller).toEqual(unknownIdentity());
    expect(result.evidenceIds.every(id => (SESSION_EVIDENCE_IDS as readonly string[]).includes(id))).toBe(true);
  });

  it('does not mutate the assessment or share mutable output arrays with it', () => {
    const input = status({ evidence: [evidence('fingerprint', { signal: 'automation-indicator', marker: 'playwright-binding' })] });
    const original = structuredClone(input);
    const result = toSessionObservation(input);
    result.evidenceIds.length = 0;
    result.controller.evidenceIds.length = 0;
    result.automationStack.frameworks.length = 0;
    expect(input).toEqual(original);
    expect(toSessionObservation(input).evidenceIds).toEqual(['fingerprint:playwright-binding']);
  });

  it('produces observations accepted by the session engine without another normalization step', async () => {
    const store = new AgentSessionStore({ async readSession() {}, async readHistory() {},
      async writeSession() {}, async writeHistory() {} }, { now: () => NOW });
    const result = await store.observe(toSessionObservation(status()));
    expect(result?.controlState).toBe('AUTOMATION_LIKELY');
    expect(result?.controller).toEqual(unknownIdentity());
  });
});

describe('session observation malformed input guard', () => {
  it.each([
    { domain: 'https://example.com/private?token=secret' }, { domain: 'example.com/path' }, { domain: '*.example.com' },
    { domain: 'EXAMPLE.COM' }, { domain: '' }, { tabId: -1 }, { tabId: 2_147_483_648 },
    { confidence: Number.NaN }, { confidence: 2 }, { assessedAt: -1 }, { expiresAt: NOW },
    { expiresAt: NOW + 90_001 }, { evidence: [] }, { coverage: [] },
    { status: 'HUMAN' }, { evidence: null }, { coverage: null },
  ])('rejects malformed assessment fields without exposing their values: %j', patch => {
    expect(() => toSessionObservation({ ...status(), ...patch } as TabAgentStatus)).toThrow('Invalid session observation source');
  });

  it.each([
    { metadata: { signal: 'automation-indicator', webdriver: true, token: 'SECRET' } },
    { metadata: { signal: 'automation-indicator', webdriver: false } },
    { metadata: { signal: 'automation-indicator', marker: 'unknown-secret' }, detector: 'fingerprint' },
    { metadata: { signal: 'automation-indicator', bucket: 'raw-input-SECRET' }, detector: 'behavior', family: 'behavior' },
    { detector: 'SECRET detector' }, { family: 'debugger' }, { confidence: Number.POSITIVE_INFINITY },
    { observedAt: NOW + 1 }, { expiresAt: NOW }, { expiresAt: NOW + 90_001 }, { metadata: null },
  ])('rejects unsupported or expired evidence: %j', patch => {
    const input = status();
    input.evidence[0] = { ...input.evidence[0], ...patch } as DetectionEvidence;
    expect(() => toSessionObservation(input)).toThrow('Invalid session observation source');
  });

  it('rejects duplicate coverage and unsupported detector availability', () => {
    const input = status();
    input.coverage = [input.coverage[0]!, input.coverage[0]!];
    expect(() => toSessionObservation(input)).toThrow('Invalid session observation source');
    input.coverage = [{ detector: 'webdriver', availability: 'secret' as 'available', reason: 'secret' }];
    expect(() => toSessionObservation(input)).toThrow('Invalid session observation source');
  });

  it.each([
    { activityDelta: { ...emptyActivity(), inputValue: 'SECRET' } },
    { activityDelta: { ...emptyActivity(), submits: -1 } },
    { activityDelta: { ...emptyActivity(), submits: 0.5 } },
    { activityDelta: { ...emptyActivity(), submits: 1_000_000_001 } },
    { activityDelta: {} }, { activityDelta: null }, { lastActivityAt: NOW + 1 }, { lastActivityAt: -1 }, { lastActivityAt: Number.NaN },
    { token: 'SECRET' },
  ])('rejects unvalidated activity: %j', activity => {
    expect(() => toSessionObservation(status(), activity as SessionActivity)).toThrow('Invalid session observation source');
  });
});
