import type { DetectionEvidence, DetectorId, TabAgentStatus } from '../shared/contracts';
import { normalizeDomain } from '../shared/domains';
import {
  ACTIVITY_KEYS, CONTROL_STATES, emptyActivity, hasAutomation, unknownIdentity,
  type ActivityCounters, type Framework, type IntelligenceObservation, type Transport,
} from '../shared/intelligence';
import { SESSION_EVIDENCE_IDS } from './agent-sessions';

export interface SessionActivity {
  /** Document-bound deltas supplied by the worker, never rolling totals from detector evidence. */
  activityDelta?: Readonly<ActivityCounters>;
  lastActivityAt?: number | null;
}

const DETECTOR_FAMILIES = { webdriver: 'runtime', debugger: 'debugger', fingerprint: 'runtime', behavior: 'behavior' } as const;
const MARKER_FRAMEWORKS: Readonly<Record<string, Framework>> = {
  'playwright-binding': 'Playwright-like', 'playwright-init': 'Playwright-like',
  'selenium-global': 'Selenium-like', 'webdriver-global': 'WebDriver-compatible',
};
type EvidenceId = typeof SESSION_EVIDENCE_IDS[number];

function invalid(): never { throw new Error('Invalid session observation source'); }
function timestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function score(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function detector(value: unknown): value is DetectorId {
  return typeof value === 'string' && Object.hasOwn(DETECTOR_FAMILIES, value);
}
function evidenceId(evidence: DetectionEvidence, assessedAt: number): EvidenceId {
  if (!record(evidence) || !detector(evidence.detector) || evidence.family !== DETECTOR_FAMILIES[evidence.detector] ||
      !score(evidence.confidence) || !timestamp(evidence.observedAt) || evidence.observedAt > assessedAt ||
      !timestamp(evidence.expiresAt) || evidence.expiresAt <= assessedAt || evidence.expiresAt > assessedAt + 90_000 ||
      !record(evidence.metadata)) return invalid();
  const metadata = evidence.metadata;
  let id: string | undefined;
  let keys: readonly string[] = [];
  if (evidence.detector === 'webdriver' && metadata.signal === 'automation-indicator' && metadata.webdriver === true) {
    id = 'webdriver:webdriver';
    keys = ['signal', 'webdriver'];
  } else if (evidence.detector === 'debugger' && metadata.signal === 'automation-indicator' && metadata.attached === true) {
    id = 'debugger:attached';
    keys = ['signal', 'attached'];
  } else if (evidence.detector === 'fingerprint' && metadata.signal === 'automation-indicator' &&
      typeof metadata.marker === 'string' && Object.hasOwn(MARKER_FRAMEWORKS, metadata.marker)) {
    id = `fingerprint:${metadata.marker}`;
    keys = ['signal', 'marker'];
  } else if (evidence.detector === 'behavior') {
    if (metadata.signal === 'trusted-activity') {
      id = 'behavior:trusted-activity';
      keys = ['signal'];
    } else if (metadata.signal === 'automation-indicator' &&
        (metadata.bucket === 'synthetic-interactions' || metadata.bucket === 'regular-timing')) {
      id = `behavior:${metadata.bucket}`;
      keys = ['signal', 'bucket'];
    }
  }
  if (!id || !SESSION_EVIDENCE_IDS.includes(id as EvidenceId) ||
      Object.keys(metadata).length !== keys.length || Object.keys(metadata).some(key => !keys.includes(key))) return invalid();
  return id as EvidenceId;
}

/** Map a validated assessment to an allowlisted, privacy-safe observation, never controller identity. */
export function toSessionObservation(status: Readonly<TabAgentStatus>, activity: SessionActivity = {}): IntelligenceObservation {
  if (!record(status) || !timestamp(status.tabId) || status.tabId > 2_147_483_647 ||
      !CONTROL_STATES.includes(status.status) || !score(status.confidence) || !timestamp(status.assessedAt) ||
      !timestamp(status.expiresAt) || status.expiresAt <= status.assessedAt || status.expiresAt > status.assessedAt + 90_000 ||
      !Array.isArray(status.evidence) || status.evidence.length > 20 || !Array.isArray(status.coverage) || status.coverage.length > 4) return invalid();
  if (status.domain !== null) {
    if (typeof status.domain !== 'string' || status.domain.startsWith('*.')) return invalid();
    try { if (normalizeDomain(status.domain) !== status.domain) return invalid(); } catch { return invalid(); }
  }
  const coverage = new Map<DetectorId, boolean>();
  for (const item of status.coverage) {
    if (!record(item) || !detector(item.detector) || coverage.has(item.detector) ||
        !['available', 'unavailable', 'error'].includes(item.availability)) return invalid();
    coverage.set(item.detector, item.availability === 'available');
  }
  const evidenceIds = new Set<EvidenceId>();
  const frameworkEvidence = new Set<EvidenceId>();
  const transports = new Set<Transport>();
  const frameworks = new Set<Framework>();
  let frameworkConfidence = 0;
  let expiresAt = status.expiresAt;
  let automationObserved = false;
  for (const evidence of status.evidence) {
    const id = evidenceId(evidence, status.assessedAt);
    if (!coverage.get(evidence.detector)) return invalid();
    evidenceIds.add(id);
    expiresAt = Math.min(expiresAt, evidence.expiresAt);
    automationObserved ||= evidence.metadata.signal === 'automation-indicator';
    if (id === 'webdriver:webdriver') transports.add('WebDriver');
    if (id === 'debugger:attached') transports.add('CDP');
    if (evidence.detector === 'fingerprint') {
      const framework = MARKER_FRAMEWORKS[String(evidence.metadata.marker)];
      if (!framework) return invalid();
      frameworks.add(framework);
      frameworkEvidence.add(id);
      frameworkConfidence = Math.max(frameworkConfidence, evidence.confidence);
    }
  }
  if (hasAutomation(status.status) && !automationObserved) return invalid();
  if (!record(activity) || Object.keys(activity).some(key => key !== 'activityDelta' && key !== 'lastActivityAt')) return invalid();
  const activityDelta = activity.activityDelta === undefined ? emptyActivity() : activity.activityDelta;
  if (!record(activityDelta) || Object.keys(activityDelta).length !== ACTIVITY_KEYS.length ||
      Object.keys(activityDelta).some(key => !(ACTIVITY_KEYS as readonly string[]).includes(key)) ||
      ACTIVITY_KEYS.some(key => !timestamp(activityDelta[key]) || activityDelta[key] > 1_000_000_000)) return invalid();
  const lastActivityAt = activity.lastActivityAt ?? null;
  if (lastActivityAt !== null && (!timestamp(lastActivityAt) || lastActivityAt > status.assessedAt)) return invalid();
  const counters = emptyActivity();
  for (const key of ACTIVITY_KEYS) counters[key] = activityDelta[key] as number;
  const controller = unknownIdentity();
  if (frameworks.size > 0) {
    controller.attributionLevel = 'FRAMEWORK_ONLY';
    controller.evidenceIds = [...frameworkEvidence];
  }
  return {
    tabId: status.tabId, domain: status.domain, controlState: status.status, controller,
    automationStack: { transports: [...transports], frameworks: [...frameworks], environmentHints: [], controllerCandidates: [] },
    controlScore: status.confidence, frameworkConfidence,
    coverageScore: coverage.size ? [...coverage.values()].filter(Boolean).length / coverage.size : 0,
    evidenceIds: [...evidenceIds], observedAt: status.assessedAt, expiresAt, lastActivityAt,
    activityDelta: counters,
  };
}
