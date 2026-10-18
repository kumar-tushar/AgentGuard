import type { AgentSession, ControlState, DebuggerIntelligenceView, SessionReport } from './intelligence';
import type { BrowserStatistics, SessionSummaryReport } from './reports';
import type { EmergencyState } from './emergency';
import type { ActionCapability, ControlsView, GrantPreset, OneTimeAllowance } from './controls';
import type { PendingUpdate } from './updates';
import type { DownloadPolicy, DownloadRecord, TrafficView } from './traffic';
import type { SiteDeclaration, TrustLookup, TrustProvider } from './integrations';
/** Scores are heuristic support, never a probability or proof of AI control. */
export type TabState = ControlState;
export type DetectorId = 'webdriver' | 'fingerprint' | 'debugger' | 'behavior';
export type SignalFamily = 'runtime' | 'debugger' | 'behavior';
export type Availability = 'available' | 'unavailable' | 'error';
export type Fingerprint = 'playwright-binding' | 'playwright-init' | 'selenium-global' | 'webdriver-global' | 'playwright-stack' | 'puppeteer-stack';
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
  /** Coarse activity context/counters only; never automation detection or scoring. */
  behaviorEnabled: boolean;
  policyMode: 'monitor' | 'warn' | 'block';
  sensitiveDomains: string[];
  minimumConfidence: number;
  retentionDays: number;
  maxAuditEvents: number;
  sessionRetentionDays: number;
  maxHistorySessions: number;
  employeeControlsAllowed?: boolean;
  maximumGrantMinutes?: number;
  observationAllowed?: boolean;
  downloadPolicy?: DownloadPolicy;
  desktopNotifications?: boolean;
  stackSignalsEnabled?: boolean;
  trustLookupEnabled?: boolean;
  trustEndpoint?: string | null;
  trustProvider?: TrustProvider;
  siteDeclarationsEnabled?: boolean;
  contributionsEnabled?: boolean;
  contributionEndpoint?: string | null;
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
export interface ReleaseResult {
  /** A request is not a guarantee that the destination finished loading. */
  navigation: 'requested' | 'not_needed' | 'unavailable';
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
  statistics?: BrowserStatistics;
  emergency?: EmergencyState;
  controls?: ControlsView;
  delegationNetworkTabs?: number[];
  pendingUpdate?: PendingUpdate | null;
  traffic?: TrafficView;
  downloads?: DownloadRecord[];
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
  | { type: 'CLEAR_SESSION_HISTORY' }
  | { type: 'GET_SESSION_REPORT'; sessionId: string }
  | { type: 'EMERGENCY_ACTIVATE'; action: 'quarantine' | 'close' }
  | { type: 'EMERGENCY_RESET' }
  | { type: 'GRANT_DELEGATION'; tabId: number; preset: GrantPreset; allowedDomains: string[]; blockedDomains: string[]; minutes: number }
  | { type: 'REVOKE_DELEGATION'; tabId: number }
  | { type: 'PAUSE_CONTROLS'; domain: string | null; minutes: number }
  | { type: 'RESUME_CONTROLS'; pauseId: string }
  | { type: 'APPLY_UPDATE' }
  | { type: 'GRANT_ONCE'; tabId: number; capability: ActionCapability }
  | { type: 'START_OBSERVATION' | 'STOP_OBSERVATION'; tabId: number }
  | { type: 'CLEAR_TRAFFIC' }
  | { type: 'LOOKUP_TRUST' | 'LOOKUP_SITE_DECLARATION'; tabId: number }
  | { type: 'CONTRIBUTE_STATISTICS'; consent: true };
export interface ResponseData {
  GET_DASHBOARD: Dashboard;
  SAVE_CONFIG: EffectiveConfig;
  QUARANTINE_TAB: QuarantineRecord;
  RELEASE_TAB: ReleaseResult;
  CLOSE_TAB: null;
  EXPORT_AUDIT: AuditEnvelope;
  CLEAR_AUDIT: null;
  GET_SESSION_HISTORY: AgentSession[];
  EXPORT_SESSIONS: SessionReport;
  CLEAR_SESSION_HISTORY: null;
  GET_SESSION_REPORT: SessionSummaryReport;
  EMERGENCY_ACTIVATE: EmergencyState;
  EMERGENCY_RESET: EmergencyState;
  GRANT_DELEGATION: ControlsView;
  REVOKE_DELEGATION: ControlsView;
  PAUSE_CONTROLS: ControlsView;
  RESUME_CONTROLS: ControlsView;
  APPLY_UPDATE: boolean;
  GRANT_ONCE: OneTimeAllowance;
  START_OBSERVATION: TrafficView;
  STOP_OBSERVATION: TrafficView;
  CLEAR_TRAFFIC: null;
  LOOKUP_TRUST: TrustLookup[];
  LOOKUP_SITE_DECLARATION: SiteDeclaration;
  CONTRIBUTE_STATISTICS: null;
}
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
