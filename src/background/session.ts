import type { DetectionEvidence, DetectorCoverage, DetectorId, QuarantineRecord, TabAgentStatus } from '../shared/contracts';
import { scoreAssessment } from '../detection/scoring';
import { normalizeDomain } from '../shared/domains';
import { CONTROL_STATES, hasAutomation } from '../shared/intelligence';

export const MAX_SESSION_TABS = 500;
const DETECTOR_FAMILIES = { webdriver: 'runtime', fingerprint: 'runtime', debugger: 'debugger', behavior: 'behavior' } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDomain(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || value.startsWith('*.')) return false;
  try { return normalizeDomain(value) === value; } catch { return false; }
}

function validTabId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2_147_483_647;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validDetector(value: unknown): value is DetectorId {
  return typeof value === 'string' && Object.hasOwn(DETECTOR_FAMILIES, value);
}

function validEvidence(value: unknown, assessedAt: number): value is DetectionEvidence {
  if (!isRecord(value) || !hasOnlyKeys(value, ['detector', 'family', 'confidence', 'description', 'metadata', 'observedAt', 'expiresAt']) ||
      !validDetector(value.detector) || value.family !== DETECTOR_FAMILIES[value.detector] ||
      !validConfidence(value.confidence) || typeof value.description !== 'string' || value.description.length > 256 ||
      !validTimestamp(value.observedAt) || value.observedAt > assessedAt ||
      !validTimestamp(value.expiresAt) || value.expiresAt <= value.observedAt || value.expiresAt > assessedAt + 90_000 ||
      !isRecord(value.metadata)) return false;
  const metadata = value.metadata;
  if (value.detector === 'webdriver') return hasOnlyKeys(metadata, ['signal', 'webdriver']) &&
    metadata.signal === 'automation-indicator' && metadata.webdriver === true;
  if (value.detector === 'debugger') return hasOnlyKeys(metadata, ['signal', 'attached']) &&
    metadata.signal === 'automation-indicator' && metadata.attached === true;
  if (value.detector === 'fingerprint') return hasOnlyKeys(metadata, ['signal', 'marker']) &&
    metadata.signal === 'automation-indicator' && typeof metadata.marker === 'string' &&
    ['playwright-binding', 'playwright-init', 'selenium-global', 'webdriver-global'].includes(metadata.marker);
  return metadata.signal === 'trusted-activity' ? hasOnlyKeys(metadata, ['signal']) :
    hasOnlyKeys(metadata, ['signal', 'bucket']) && metadata.signal === 'automation-indicator' &&
      (metadata.bucket === 'synthetic-interactions' || metadata.bucket === 'regular-timing');
}

function validCoverage(value: unknown): value is DetectorCoverage {
  return isRecord(value) && hasOnlyKeys(value, ['detector', 'availability', 'reason']) &&
    validDetector(value.detector) && typeof value.availability === 'string' &&
    ['available', 'unavailable', 'error'].includes(value.availability) &&
    typeof value.reason === 'string' && value.reason.length <= 240;
}

function validStatus(value: unknown): value is TabAgentStatus {
  if (!isRecord(value) || !hasOnlyKeys(value, ['tabId', 'domain', 'status', 'identifiedAgent', 'frameworkHints', 'confidence',
      'evidence', 'coverage', 'firstDetectedAt', 'lastDetectedAt', 'assessedAt', 'expiresAt', 'policy']) ||
      !validTabId(value.tabId) || !validDomain(value.domain) || typeof value.status !== 'string' ||
      !(CONTROL_STATES as readonly string[]).includes(value.status) || !validConfidence(value.confidence) ||
      !validTimestamp(value.assessedAt) || !validTimestamp(value.expiresAt) ||
      value.expiresAt <= value.assessedAt || value.expiresAt > value.assessedAt + 90_000 ||
      !Array.isArray(value.evidence) || value.evidence.length > 20 ||
      !Array.isArray(value.coverage) || value.coverage.length > 20 ||
      !Array.isArray(value.frameworkHints) || value.frameworkHints.length > 10 ||
      !isRecord(value.policy) || !hasOnlyKeys(value.policy, ['action', 'reason', 'matchedDomain']) || value.identifiedAgent !== null) return false;
  const assessedAt = value.assessedAt;
  const coverage = value.coverage;
  if (!value.evidence.every((evidence: unknown): evidence is DetectionEvidence => validEvidence(evidence, assessedAt)) ||
      !coverage.every(validCoverage) ||
      new Set(coverage.map((item) => item.detector)).size !== coverage.length ||
      value.evidence.some((item) => !coverage.some((entry) => entry.detector === item.detector && entry.availability === 'available')) ||
      typeof value.policy.action !== 'string' || !['none', 'monitor', 'warn', 'quarantine'].includes(value.policy.action) ||
      !validDomain(value.policy.matchedDomain) || typeof value.policy.reason !== 'string' || value.policy.reason.length > 240) return false;
  const positive = hasAutomation(value.status as TabAgentStatus['status']);
  if (positive ? !validTimestamp(value.firstDetectedAt) || !validTimestamp(value.lastDetectedAt) ||
      value.firstDetectedAt > value.lastDetectedAt || value.lastDetectedAt > assessedAt :
      value.firstDetectedAt !== null || value.lastDetectedAt !== null) return false;
  // A persisted label must still be justified by its evidence, including after a worker restart.
  const scored = scoreAssessment({ now: assessedAt, runtime: null, behavior: null, debuggerAttached: null,
    runtimeReason: '', debuggerReason: '' }, value.evidence, coverage);
  return scored.status === value.status && scored.confidence === value.confidence &&
    JSON.stringify(scored.frameworkHints) === JSON.stringify(value.frameworkHints);
}

function validQuarantine(value: unknown): value is QuarantineRecord {
  return isRecord(value) && hasOnlyKeys(value, ['tabId', 'domain', 'createdAt', 'reason', 'networkBlocked']) &&
    validTabId(value.tabId) && validDomain(value.domain) &&
    validTimestamp(value.createdAt) && typeof value.networkBlocked === 'boolean' &&
    typeof value.reason === 'string' && value.reason.length <= 240;
}

export interface SessionData {
  tabs: Record<number, TabAgentStatus>;
  quarantines: Record<number, QuarantineRecord>;
}
export interface SessionPort {
  read(): Promise<unknown>;
  write(data: SessionData): Promise<void>;
}

/** Session snapshots survive service-worker suspension, never a full browser restart. */
export class SessionStore {
  readonly tabs = new Map<number, TabAgentStatus>();
  readonly quarantines = new Map<number, QuarantineRecord>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly port: SessionPort) {}

  async load(liveTabIds: ReadonlySet<number>): Promise<void> {
    const raw = await this.port.read();
    this.tabs.clear();
    this.quarantines.clear();
    if (!isRecord(raw)) return;
    const tabs = isRecord(raw.tabs) ? Object.entries(raw.tabs).slice(0, MAX_SESSION_TABS) : [];
    for (const [key, value] of tabs) {
      if (validStatus(value) && String(value.tabId) === key && liveTabIds.has(value.tabId)) {
        this.tabs.set(value.tabId, structuredClone(value));
      }
    }
    const quarantines = isRecord(raw.quarantines) ? Object.entries(raw.quarantines).slice(0, MAX_SESSION_TABS) : [];
    for (const [key, value] of quarantines) {
      if (validQuarantine(value) && String(value.tabId) === key && liveTabIds.has(value.tabId)) {
        this.quarantines.set(value.tabId, structuredClone(value));
      }
    }
  }

  persist(): Promise<void> {
    // Capture at enqueue time so older async writes cannot replace newer snapshots.
    const snapshot: SessionData = structuredClone({
      tabs: Object.fromEntries(this.tabs),
      quarantines: Object.fromEntries(this.quarantines),
    });
    const write = this.queue.then(() => this.port.write(snapshot));
    this.queue = write.catch(() => undefined);
    return write;
  }
}
