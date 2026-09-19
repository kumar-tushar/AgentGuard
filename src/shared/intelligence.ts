/** Versioned intelligence contracts. No state asserts human control or safety. */
export const CONTROL_STATES = [
  'AGENT_ACTIVE', 'AGENT_CONNECTED', 'AUTOMATION_LIKELY',
  'AUTOMATION_SUSPECTED', 'NO_AUTOMATION_OBSERVED', 'UNMONITORED',
] as const;
export type ControlState = typeof CONTROL_STATES[number];
export type AttributionLevel = 'VERIFIED' | 'HIGH_CONFIDENCE' | 'CORRELATED' | 'FRAMEWORK_ONLY' | 'UNATTRIBUTED';
export type DetectorHealth = 'AVAILABLE' | 'UNAVAILABLE' | 'DEGRADED' | 'ERROR';
export type Transport = 'CDP' | 'WebDriver' | 'In-page JavaScript' | 'Trusted extension integration' | 'Unknown';
export type Framework = 'Playwright-like' | 'Puppeteer-like' | 'Selenium-like' | 'WebDriver-compatible';
export type EnvironmentHint = 'Linux platform' | 'Software rendering' | 'Headless browser' | 'Virtual-display-like' | 'Cloud-browser-like';
export type TimelineKind = 'OBSERVED' | 'INFERRED' | 'VERIFIED' | 'ALLOWED' | 'BLOCKED' | 'CONTAINED';

export interface AgentIdentity {
  displayName: string | null;
  vendor: string | null;
  product: string | null;
  version: string | null;
  attributionLevel: AttributionLevel;
  confidence: number;
  evidenceIds: string[];
}
export interface AutomationStack {
  transports: Transport[];
  frameworks: Framework[];
  environmentHints: EnvironmentHint[];
  controllerCandidates: AgentIdentity[];
}
export interface ActivityCounters {
  navigations: number;
  pointerInteractions: number;
  keyboardInteractions: number;
  inputInteractions: number;
  scrolls: number;
  submits: number;
  syntheticInteractions: number;
}
export const ACTIVITY_KEYS = [
  'navigations', 'pointerInteractions', 'keyboardInteractions', 'inputInteractions',
  'scrolls', 'submits', 'syntheticInteractions',
] as const satisfies readonly (keyof ActivityCounters)[];
export interface SessionTimelineEvent {
  id: string;
  timestamp: number;
  kind: TimelineKind;
  type: 'session_started' | 'session_active' | 'session_connected' | 'session_ended' |
    'evidence_updated' | 'navigation_observed' | 'background_interaction' | 'coverage_changed' |
    'policy_triggered' | 'boundary_violation' | 'allow_once_granted' | 'containment_requested' | 'containment_failed' |
    'delegation_changed' | 'alert_shown';
  description: string;
}
export interface AgentSession {
  id: string;
  tabId: number;
  domain: string | null;
  controlState: ControlState;
  controller: AgentIdentity;
  automationStack: AutomationStack;
  controlScore: number;
  frameworkConfidence: number;
  coverageScore: number;
  startedAt: number;
  lastActivityAt: number | null;
  lastObservedAt: number;
  expiresAt: number;
  endedAt: number | null;
  endReason: 'closed' | 'evidence_expired' | 'no_evidence' | 'browser_restart' | 'monitoring_disabled' | null;
  active: boolean;
  evidenceIds: string[];
  observedActivity: ActivityCounters;
  timeline: SessionTimelineEvent[];
}
export interface IntelligenceObservation {
  tabId: number;
  domain: string | null;
  controlState: ControlState;
  controller: AgentIdentity;
  automationStack: AutomationStack;
  controlScore: number;
  frameworkConfidence: number;
  coverageScore: number;
  evidenceIds: string[];
  observedAt: number;
  expiresAt: number;
  lastActivityAt: number | null;
  /** Worker-validated, document-bound deltas, not repeated rolling totals. */
  activityDelta: ActivityCounters;
}
export interface SessionReport {
  schemaVersion: 1;
  exportedAt: number;
  source: 'agentguard-extension';
  sessions: AgentSession[];
  history: AgentSession[];
}
export type AttributionResult =
  | { state: 'CERTAIN'; sessionId: string }
  | { state: 'PROBABLE'; sessionId: string; confidence: number }
  | { state: 'UNKNOWN' };
export type EnforcementStrength = 'ENFORCED' | 'BEST_EFFORT' | 'INTENT_ONLY';
export type DelegationPreset = 'READ_ONLY' | 'LIMITED' | 'FULL_ACCESS' | 'CUSTOM';
export type DelegatedCapability = 'navigate' | 'click' | 'type' | 'submit' | 'open_window' | 'network';
export interface Delegation {
  id: string;
  sessionId: string;
  preset: DelegationPreset;
  capabilities: DelegatedCapability[];
  allowedDomains: string[];
  blockedDomains: string[];
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  enforcement: EnforcementStrength;
}
/** Future opt-in provider boundary only. No implementation may make hidden network requests. */
export interface AgentTrustProvider {
  lookup(identity: Readonly<AgentIdentity>, signal: AbortSignal): Promise<{
    source: string;
    checkedAt: number;
    expiresAt: number;
    approved: boolean | null;
  }>;
}
export interface CommunityIntelligenceProvider {
  contribute(summary: Readonly<{ schemaVersion: 1; detectorCounts: Record<string, number> }>, signal: AbortSignal): Promise<void>;
}

export const emptyActivity = (): ActivityCounters => ({
  navigations: 0, pointerInteractions: 0, keyboardInteractions: 0, inputInteractions: 0,
  scrolls: 0, submits: 0, syntheticInteractions: 0,
});
export const unknownIdentity = (): AgentIdentity => ({
  displayName: null, vendor: null, product: null, version: null,
  attributionLevel: 'UNATTRIBUTED', confidence: 0, evidenceIds: [],
});
export function hasAutomation(state: ControlState): boolean {
  return state !== 'NO_AUTOMATION_OBSERVED' && state !== 'UNMONITORED';
}

/** Tab-scoped association is never inferred from there being only one session. */
export function attributeActivity(tabId: number | undefined, sessions: readonly AgentSession[]): AttributionResult {
  if (tabId === undefined) return { state: 'UNKNOWN' };
  const matches = sessions.filter(session => session.tabId === tabId && session.endedAt === null);
  // A matching tab is correlation, not proof that the agent initiated the event.
  return matches.length === 1
    ? { state: 'PROBABLE', sessionId: matches[0]!.id, confidence: 0.5 }
    : { state: 'UNKNOWN' };
}

export function mayEnforce(attribution: AttributionResult, coarsePolicy = false): boolean {
  return coarsePolicy || attribution.state === 'CERTAIN';
}

export type DebuggerTargetType = 'page' | 'background_page' | 'worker' | 'service_worker' | 'other';
export type DebuggerTransitionType = 'target_seen' | 'attachment_observed' | 'detachment_observed' |
  'target_disappeared' | 'coverage_lost' | 'coverage_restored';
export interface DebuggerTargetTransition { type: DebuggerTransitionType; timestamp: number }
export interface DebuggerTargetRecord {
  targetId: string;
  type: DebuggerTargetType;
  tabId: number | null;
  domain: string | null;
  /** Last sampled attachment flag, not a current assertion or controller attribution. */
  attached: boolean;
  owner: 'unknown';
  firstSeen: number;
  lastSeen: number;
  /** The first observation establishes a baseline, not an exact attachment start. */
  lastObservedAttachedChange: number;
  disappearedAt: number | null;
  sampledAttachmentStartedAt: number | null;
  /** Time between attachment samples only; unobserved detach/reattach cycles remain possible. */
  sampledAttachmentSpanMs: number;
  timeline: DebuggerTargetTransition[];
}
export interface DebuggerIntelligenceData {
  schemaVersion: 1;
  coverageAvailable: boolean;
  lastCapturedAt: number | null;
  targets: DebuggerTargetRecord[];
}
export interface DebuggerTargetView extends DebuggerTargetRecord {
  observationFresh: boolean;
  currentAttached: boolean | null;
}
export interface DebuggerIntelligenceView {
  coverageAvailable: boolean;
  lastCapturedAt: number | null;
  targets: DebuggerTargetView[];
}
