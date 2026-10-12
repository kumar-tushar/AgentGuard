import type { AgentSession, ControlState, DebuggerIntelligenceView, SessionReport } from './intelligence';
/** Scores are heuristic support, never a probability or proof of AI control. */
export type TabState = ControlState;
export type DetectorId = 'webdriver' | 'fingerprint' | 'debugger' | 'behavior';
export type SignalFamily = 'runtime' | 'debugger' | 'behavior';
export type Availability = 'available' | 'unavailable' | 'error';
export type Fingerprint = 'playwright-binding' | 'playwright-init' | 'selenium-global' | 'webdriver-global';
export type EvidenceMetadata = Readonly<Record<string, string | number | boolean>>;

export interface DetectionEvidence {
  detector: DetectorId;
  family: SignalFamily;
  confidence: number;
  description: string;
  metadata: EvidenceMetadata;
  observedAt: number;
  expiresAt: number;
}
export interface DetectorCoverage {
  detector: DetectorId;
  availability: Availability;
  reason: string;
}
export interface DetectorResult {
  evidence: DetectionEvidence[];
  coverage: DetectorCoverage;
}
export interface RuntimeSnapshot {
  webdriver: boolean | null;
  /** Null means the existence checks failed, not that no markers were observed. */
  fingerprints: Fingerprint[] | null;
}
export interface BehaviorSnapshot {
  trustedEvents: number;
  syntheticEvents: number;
  intervalSamples: number;
  meanIntervalMs: number;
  intervalVariance: number;
  lastTrustedAt: number | null;
  startedAt: number;
}
export interface DetectionContext {
  now: number;
  runtime: RuntimeSnapshot | null;
  behavior: BehaviorSnapshot | null;
  debuggerAttached: boolean | null;
  runtimeReason: string;
  debuggerReason: string;
}
export interface Detector {
  readonly id: DetectorId;
  readonly family: SignalFamily;
  detect(context: Readonly<DetectionContext>): DetectorResult | Promise<DetectorResult>;
}
export interface TabAgentStatus {
  tabId: number;
  domain: string | null;
  status: TabState;
  identifiedAgent: string | null;
  frameworkHints: string[];
  confidence: number;
  evidence: DetectionEvidence[];
  coverage: DetectorCoverage[];
  firstDetectedAt: number | null;
  lastDetectedAt: number | null;
  assessedAt: number;
  expiresAt: number;
  policy: PolicyDecision;
}
export type PolicyAction = 'none' | 'monitor' | 'warn' | 'quarantine';
export interface PolicyDecision {
  action: PolicyAction;
  reason: string;
  matchedDomain: string | null;
}
export interface AgentGuardConfig {
  schemaVersion: 1;
  monitoringEnabled: boolean;
  behaviorEnabled: boolean;
  policyMode: 'monitor' | 'warn' | 'block';
  sensitiveDomains: string[];
  minimumConfidence: number;
  retentionDays: number;
  maxAuditEvents: number;
  sessionRetentionDays: number;
  maxHistorySessions: number;
}
export interface EffectiveConfig {
  values: AgentGuardConfig;
  managedKeys: (keyof AgentGuardConfig)[];
  errors: string[];
}
export type AuditEventType = 'detection_changed' | 'policy_triggered' | 'quarantined' | 'released' | 'tab_closed' | 'settings_changed' | 'enforcement_failed' | 'coverage_changed';
export interface AuditEvent {
  id: string;
  timestamp: number;
  tabId: number | null;
  domain: string | null;
  eventType: AuditEventType;
  detectedAgent: string | null;
  confidence: number;
  policyAction: PolicyAction;
  detail: string;
}
export interface AuditEnvelope {
  schemaVersion: 1;
  exportedAt: number;
  source: 'agentguard-extension';
  events: AuditEvent[];
}
/** A future backend adapter must implement its own authentication and transport. */
export interface AuditSink { write(batch: Readonly<AuditEnvelope>): Promise<void> }
export interface QuarantineRecord {
  tabId: number;
  domain: string | null;
  createdAt: number;
  reason: string;
  networkBlocked: boolean;
}
export interface Capabilities {
  /** Successful passive target inspection, not just a declared permission; individual tabs may remain unavailable. */
  debugger: boolean;
  networkBlocking: boolean;
  origins: string[];
}
export interface Dashboard {
  config: EffectiveConfig;
  capabilities: Capabilities;
  tabs: TabAgentStatus[];
  audit: AuditEvent[];
  quarantines: QuarantineRecord[];
  healthErrors: string[];
  sessions: AgentSession[];
  debuggerIntelligence: DebuggerIntelligenceView;
}
export type Request =
  | { type: 'GET_DASHBOARD' }
  | { type: 'SAVE_CONFIG'; config: AgentGuardConfig }
  | { type: 'QUARANTINE_TAB'; tabId: number }
  | { type: 'RELEASE_TAB'; tabId: number }
  | { type: 'CLOSE_TAB'; tabId: number }
  | { type: 'EXPORT_AUDIT' }
  | { type: 'CLEAR_AUDIT' }
  | { type: 'GET_SESSION_HISTORY' }
  | { type: 'EXPORT_SESSIONS' }
  | { type: 'CLEAR_SESSION_HISTORY' };
export interface ResponseData {
  GET_DASHBOARD: Dashboard;
  SAVE_CONFIG: EffectiveConfig;
  QUARANTINE_TAB: QuarantineRecord;
  RELEASE_TAB: null;
  CLOSE_TAB: null;
  EXPORT_AUDIT: AuditEnvelope;
  CLEAR_AUDIT: null;
  GET_SESSION_HISTORY: AgentSession[];
  EXPORT_SESSIONS: SessionReport;
  CLEAR_SESSION_HISTORY: null;
}
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
