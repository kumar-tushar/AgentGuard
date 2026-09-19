import { normalizeDomain } from '../shared/domains';
import {
  ACTIVITY_KEYS, CONTROL_STATES, emptyActivity, hasAutomation,
  type ActivityCounters, type AgentIdentity, type AgentSession, type AutomationStack,
  type IntelligenceObservation, type SessionTimelineEvent, type TimelineKind,
} from '../shared/intelligence';

export const MAX_AGENT_SESSIONS = 500;
export const MAX_SESSION_TIMELINE = 100;
export const ACTIVE_ACTIVITY_WINDOW_MS = 30_000;
const MAX_EVIDENCE_TTL_MS = 90_000;
const MAX_ACTIVITY_COUNT = 1_000_000_000;
const DAY_MS = 86_400_000;

/** Only extension-defined signal labels enter persisted records, never page-provided identifiers. */
export const SESSION_EVIDENCE_IDS = [
  'webdriver:webdriver', 'debugger:attached',
  'fingerprint:playwright-binding', 'fingerprint:playwright-init',
  'fingerprint:selenium-global', 'fingerprint:webdriver-global',
  'runtime-stack:playwright-evaluate', 'runtime-stack:puppeteer-evaluate',
  'environment:software-renderer', 'environment:linux-platform', 'environment:headless-browser',
  'environment:virtual-display', 'environment:cloud-browser',
  'behavior:trusted-activity', 'behavior:background-interaction',
  'behavior:synthetic-interactions', 'behavior:regular-timing',
  'navigation:automated-navigation',
] as const;

export const SAFE_TIMELINE_DESCRIPTIONS: Record<SessionTimelineEvent['type'], string> = {
  session_started: 'Automation observation session started',
  session_active: 'Recent activity observed alongside strong automation evidence',
  session_connected: 'Automation evidence remains; recent activity is not observed',
  session_ended: 'Automation observation session ended',
  evidence_updated: 'Automation evidence changed',
  navigation_observed: 'Navigation observed during automation session',
  background_interaction: 'Interaction observed while the tab was inactive',
  coverage_changed: 'Detection coverage changed',
  policy_triggered: 'Automation policy triggered',
  boundary_violation: 'Delegation boundary violation observed',
  allow_once_granted: 'One-time allowance granted',
  containment_requested: 'Tab containment requested',
  containment_failed: 'Tab containment failed',
  delegation_changed: 'Delegated permissions changed',
  alert_shown: 'Automation alert shown',
};
const TIMELINE_KINDS: readonly TimelineKind[] = ['OBSERVED', 'INFERRED', 'VERIFIED', 'ALLOWED', 'BLOCKED', 'CONTAINED'];
const END_REASONS = ['closed', 'evidence_expired', 'no_evidence', 'browser_restart', 'monitoring_disabled'] as const;
const TRANSPORTS = ['CDP', 'WebDriver', 'In-page JavaScript', 'Trusted extension integration', 'Unknown'];
const FRAMEWORKS = ['Playwright-like', 'Puppeteer-like', 'Selenium-like', 'WebDriver-compatible'];
const ENVIRONMENT_HINTS = ['Linux platform', 'Software rendering', 'Headless browser', 'Virtual-display-like', 'Cloud-browser-like'];
const IDENTITY_KEYS = ['displayName', 'vendor', 'product', 'version', 'attributionLevel', 'confidence', 'evidenceIds'];
const OBSERVATION_KEYS = ['tabId', 'domain', 'controlState', 'controller', 'automationStack', 'controlScore',
  'frameworkConfidence', 'coverageScore', 'evidenceIds', 'observedAt', 'expiresAt', 'lastActivityAt', 'activityDelta'];
const SESSION_KEYS = ['id', 'tabId', 'domain', 'controlState', 'controller', 'automationStack', 'controlScore',
  'frameworkConfidence', 'coverageScore', 'startedAt', 'lastActivityAt', 'lastObservedAt', 'expiresAt',
  'endedAt', 'endReason', 'active', 'evidenceIds', 'observedActivity', 'timeline'];

/** Session storage journals terminal transitions; local history also keeps bounded active recovery snapshots. */
export interface AgentSessionData { schemaVersion: 1; sessions: AgentSession[] }
export interface AgentSessionPort {
  readSession(): Promise<unknown>;
  writeSession(data: AgentSessionData): Promise<void>;
  readHistory(): Promise<unknown>;
  writeHistory(data: AgentSessionData): Promise<void>;
}
export interface AgentSessionLimits { maxHistorySessions: number; retentionDays: number }
export interface AgentSessionOptions {
  now?: () => number;
  limits?: () => AgentSessionLimits;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function timestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function score(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}
function domain(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || value.startsWith('*.')) return false;
  try { return normalizeDomain(value) === value; } catch { return false; }
}
function enumList(value: unknown, allowed: readonly string[], maximum = allowed.length): value is string[] {
  return Array.isArray(value) && value.length <= maximum &&
    value.every(item => typeof item === 'string' && allowed.includes(item)) && new Set(value).size === value.length;
}
function activity(value: unknown): value is ActivityCounters {
  return record(value) && onlyKeys(value, ACTIVITY_KEYS) &&
    ACTIVITY_KEYS.every(key => timestamp(value[key]) && value[key] <= MAX_ACTIVITY_COUNT);
}
function identity(value: unknown): value is AgentIdentity {
  // No authenticated identity provider exists yet. A page-declared product name is never persisted.
  return record(value) && onlyKeys(value, IDENTITY_KEYS) && value.displayName === null &&
    value.vendor === null && value.product === null && value.version === null && value.confidence === 0 &&
    (value.attributionLevel === 'UNATTRIBUTED' || value.attributionLevel === 'FRAMEWORK_ONLY') &&
    enumList(value.evidenceIds, SESSION_EVIDENCE_IDS);
}
function stack(value: unknown): value is AutomationStack {
  return record(value) && onlyKeys(value, ['transports', 'frameworks', 'environmentHints', 'controllerCandidates']) &&
    enumList(value.transports, TRANSPORTS) && enumList(value.frameworks, FRAMEWORKS) &&
    enumList(value.environmentHints, ENVIRONMENT_HINTS) && Array.isArray(value.controllerCandidates) &&
    value.controllerCandidates.length === 0;
}
function common(value: Record<string, unknown>): boolean {
  return timestamp(value.tabId) && value.tabId <= 2_147_483_647 && domain(value.domain) &&
    typeof value.controlState === 'string' && CONTROL_STATES.includes(value.controlState as AgentSession['controlState']) &&
    identity(value.controller) && stack(value.automationStack) && score(value.controlScore) &&
    score(value.frameworkConfidence) && score(value.coverageScore) && enumList(value.evidenceIds, SESSION_EVIDENCE_IDS);
}
function validObservation(value: unknown): value is IntelligenceObservation {
  if (!record(value) || !onlyKeys(value, OBSERVATION_KEYS) || !common(value) || !timestamp(value.observedAt) ||
      !timestamp(value.expiresAt) || value.expiresAt <= value.observedAt ||
      value.expiresAt - value.observedAt > MAX_EVIDENCE_TTL_MS || !activity(value.activityDelta) ||
      (value.lastActivityAt !== null && (!timestamp(value.lastActivityAt) || value.lastActivityAt > value.observedAt))) return false;
  return !hasAutomation(value.controlState as IntelligenceObservation['controlState']) ||
    (value.evidenceIds as string[]).length > 0;
}
function validTimeline(value: unknown, start: number, end: number): value is SessionTimelineEvent {
  return record(value) && onlyKeys(value, ['id', 'timestamp', 'kind', 'type', 'description']) && uuid(value.id) &&
    timestamp(value.timestamp) && value.timestamp >= start && value.timestamp <= end &&
    typeof value.kind === 'string' && TIMELINE_KINDS.includes(value.kind as TimelineKind) &&
    typeof value.type === 'string' && Object.hasOwn(SAFE_TIMELINE_DESCRIPTIONS, value.type) &&
    value.description === SAFE_TIMELINE_DESCRIPTIONS[value.type as SessionTimelineEvent['type']];
}

/** Strict nested parser: unknown fields, arbitrary text and unsupported identity claims fail closed. */
export function parseAgentSession(value: unknown, now: number): AgentSession | null {
  if (!timestamp(now) || !record(value) || !onlyKeys(value, SESSION_KEYS) || !common(value) || !uuid(value.id) ||
      !hasAutomation(value.controlState as AgentSession['controlState']) || !(value.evidenceIds as string[]).length ||
      !timestamp(value.startedAt) || !timestamp(value.lastObservedAt) || value.lastObservedAt < value.startedAt ||
      value.lastObservedAt > now || !timestamp(value.expiresAt) || value.expiresAt <= value.lastObservedAt ||
      value.expiresAt - value.lastObservedAt > MAX_EVIDENCE_TTL_MS ||
      (value.lastActivityAt !== null && (!timestamp(value.lastActivityAt) || value.lastActivityAt > value.lastObservedAt)) ||
      !activity(value.observedActivity) || !Array.isArray(value.timeline) || value.timeline.length === 0 ||
      value.timeline.length > MAX_SESSION_TIMELINE) return null;
  if (value.endedAt === null ? value.active !== true || value.endReason !== null :
    !timestamp(value.endedAt) || value.endedAt < value.lastObservedAt || value.endedAt > now || value.active !== false ||
      typeof value.endReason !== 'string' || !(END_REASONS as readonly string[]).includes(value.endReason)) return null;
  if (value.controlState === 'AGENT_ACTIVE' && (value.lastActivityAt === null ||
      value.lastObservedAt - (value.lastActivityAt as number) >= ACTIVE_ACTIVITY_WINDOW_MS)) return null;
  const timeline = value.timeline;
  if (!timeline.every(item => validTimeline(item, value.startedAt as number, value.endedAt === null ? now : value.endedAt as number)) ||
      new Set(timeline.map(item => (item as SessionTimelineEvent).id)).size !== timeline.length ||
      timeline.some((item, index) => index > 0 && (item as SessionTimelineEvent).timestamp <
        (timeline[index - 1] as SessionTimelineEvent).timestamp)) return null;
  return structuredClone(value) as unknown as AgentSession;
}

function decoded(data: unknown, now: number, maximum = MAX_AGENT_SESSIONS): AgentSession[] {
  if (!record(data) || !onlyKeys(data, ['schemaVersion', 'sessions']) || data.schemaVersion !== 1 || !Array.isArray(data.sessions)) return [];
  return data.sessions.slice(-maximum).map(item => parseAgentSession(item, now))
    .filter((item): item is AgentSession => item !== null);
}
function currentState(session: Pick<AgentSession, 'controlState' | 'lastActivityAt'>, now: number): AgentSession['controlState'] {
  return session.controlState === 'AGENT_ACTIVE' &&
    (session.lastActivityAt === null || now - session.lastActivityAt >= ACTIVE_ACTIVITY_WINDOW_MS)
    ? 'AGENT_CONNECTED' : session.controlState;
}
function requireTimestamp(now: number): void {
  if (!timestamp(now)) throw new Error('Invalid session timestamp');
}

/** Tab-indexed state, serialized mutation and bounded history; no Chrome calls or timers at import time. */
export class AgentSessionStore {
  private readonly sessions = new Map<number, AgentSession>();
  private readonly ended = new Map<string, AgentSession>();
  private readonly pendingEnded = new Map<string, AgentSession>();
  private readonly lastEndedAt = new Map<number, number>();
  private dirty = false;
  private pending: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly limits: () => AgentSessionLimits;

  constructor(private readonly port: AgentSessionPort, options: AgentSessionOptions = {}) {
    this.now = options.now ?? Date.now;
    this.limits = options.limits ?? (() => ({ maxHistorySessions: 50, retentionDays: 7 }));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      // Do not accept more mutations while a previous cross-area write is incomplete.
      if (this.dirty) await this.persist(this.now());
      return operation();
    });
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private retained(now: number): AgentSession[] {
    const { maxHistorySessions, retentionDays } = this.limits();
    if (!Number.isInteger(maxHistorySessions) || maxHistorySessions < 0 || maxHistorySessions > MAX_AGENT_SESSIONS ||
        !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) throw new Error('Invalid session retention limits');
    return [...this.ended.values()].filter(item => item.endedAt! >= now - retentionDays * DAY_MS)
      .sort((left, right) => right.endedAt! - left.endedAt!).slice(0, maxHistorySessions);
  }

  private prune(now: number): void {
    const retained = this.retained(now);
    this.ended.clear();
    // A zero-history setting or clear-history action must not immediately make a delayed
    // duplicate sample eligible for a new session. Keep bounded, ephemeral tab watermarks.
    for (const [tabId, endedAt] of this.lastEndedAt) if (endedAt < now - MAX_EVIDENCE_TTL_MS) this.lastEndedAt.delete(tabId);
    for (const item of retained) {
      this.ended.set(item.id, item);
      if (item.endReason !== 'browser_restart') {
        this.lastEndedAt.set(item.tabId, Math.max(this.lastEndedAt.get(item.tabId) ?? 0, item.endedAt!));
      }
    }
    while (this.lastEndedAt.size > MAX_AGENT_SESSIONS) this.lastEndedAt.delete(this.lastEndedAt.keys().next().value!);
    // Recovery can combine a previous transition batch with newly closed live snapshots.
    // Bound its journal independently of configurable persistent history retention.
    if (this.pendingEnded.size > MAX_AGENT_SESSIONS) {
      const terminal = [...this.pendingEnded.values()].sort((left, right) => right.endedAt! - left.endedAt!)
        .slice(0, MAX_AGENT_SESSIONS);
      this.pendingEnded.clear();
      for (const item of terminal) this.pendingEnded.set(item.id, item);
    }
  }

  private async persist(now: number): Promise<void> {
    requireTimestamp(now);
    this.dirty = true;
    this.prune(now);
    // Session storage is the transition journal: even with history disabled, a worker restart
    // sees the ended record instead of an older active snapshot if the history write fails.
    await this.port.writeSession(structuredClone({ schemaVersion: 1,
      sessions: [...this.sessions.values(), ...this.pendingEnded.values()] }));
    // Recovery snapshots never appear in history() and never restore a live tab after a browser restart.
    const { maxHistorySessions, retentionDays } = this.limits();
    const recovery = [...this.sessions.values()].filter(item => item.lastObservedAt >= now - retentionDays * DAY_MS)
      .sort((left, right) => right.lastObservedAt - left.lastObservedAt).slice(0, maxHistorySessions);
    await this.port.writeHistory(structuredClone({ schemaVersion: 1, sessions: [...recovery, ...this.ended.values()] }));
    this.pendingEnded.clear();
    this.dirty = false;
  }

  private event(session: AgentSession, kind: TimelineKind, type: SessionTimelineEvent['type'], now: number): void {
    const previous = session.timeline.at(-1);
    const time = Math.max(now, previous?.timestamp ?? session.startedAt);
    if (previous?.type === type && previous.kind === kind && previous.timestamp === time) return;
    session.timeline.push({ id: crypto.randomUUID(), timestamp: time, kind, type, description: SAFE_TIMELINE_DESCRIPTIONS[type] });
    if (session.timeline.length > MAX_SESSION_TIMELINE) session.timeline.splice(0, session.timeline.length - MAX_SESSION_TIMELINE);
  }

  private finish(session: AgentSession, reason: NonNullable<AgentSession['endReason']>, now: number): void {
    session.endedAt = Math.max(now, session.lastObservedAt, session.timeline.at(-1)?.timestamp ?? 0);
    session.endReason = reason;
    session.active = false;
    this.event(session, 'INFERRED', 'session_ended', session.endedAt);
    this.sessions.delete(session.tabId);
    this.ended.set(session.id, session);
    this.pendingEnded.set(session.id, session);
    if (reason !== 'browser_restart') this.lastEndedAt.set(session.tabId, session.endedAt);
  }

  load(liveTabIds: ReadonlySet<number>, browserRestart = false): Promise<void> {
    return this.serialize(async () => {
      const now = this.now();
      requireTimestamp(now);
      const [rawSession, rawHistory] = await Promise.all([this.port.readSession(), this.port.readHistory()]);
      this.sessions.clear();
      this.ended.clear();
      this.pendingEnded.clear();
      this.lastEndedAt.clear();
      const restarted = browserRestart || rawSession === undefined;
      const history = decoded(rawHistory, now, 2 * MAX_AGENT_SESSIONS);
      for (const item of history) if (item.endedAt !== null) this.ended.set(item.id, item);
      const recovered = decoded(rawSession, now, 2 * MAX_AGENT_SESSIONS);
      for (const item of recovered) if (item.endedAt !== null && this.pendingEnded.size < MAX_AGENT_SESSIONS) {
        this.ended.set(item.id, item);
        this.pendingEnded.set(item.id, item);
        if (item.endReason !== 'browser_restart') {
          this.lastEndedAt.set(item.tabId, Math.max(this.lastEndedAt.get(item.tabId) ?? 0, item.endedAt));
        }
      }
      const endedIds = new Set(this.ended.keys());
      this.prune(now);
      const { maxHistorySessions, retentionDays } = this.limits();
      const durableActive = restarted ? history.filter(item => item.endedAt === null &&
        item.lastObservedAt >= now - retentionDays * DAY_MS)
        .sort((left, right) => right.lastObservedAt - left.lastObservedAt).slice(0, maxHistorySessions) : [];
      const activeIds = new Set<string>();
      const activeTabs = new Set<number>();
      for (const session of [...recovered, ...durableActive]) {
        if (session.endedAt !== null || endedIds.has(session.id) || activeTabs.has(session.tabId) ||
            activeIds.has(session.id) || activeIds.size >= MAX_AGENT_SESSIONS) continue;
        activeIds.add(session.id);
        activeTabs.add(session.tabId);
        this.sessions.set(session.tabId, session);
        if (restarted) this.finish(session, 'browser_restart', now);
        else if (!liveTabIds.has(session.tabId)) this.finish(session, 'closed', now);
        else if (session.expiresAt <= now) this.finish(session, 'evidence_expired', session.expiresAt);
        else if (currentState(session, now) !== session.controlState) {
          session.controlState = 'AGENT_CONNECTED';
          this.event(session, 'INFERRED', 'session_connected', now);
        }
      }
      await this.persist(now);
    });
  }

  observe(observation: IntelligenceObservation): Promise<AgentSession | null> {
    // Clone before queuing: caller mutation must not alter a validated observation awaiting a write.
    if (!validObservation(observation)) return Promise.reject(new Error('Invalid intelligence observation'));
    const input = structuredClone(observation);
    return this.serialize(async () => {
      const clock = this.now();
      requireTimestamp(clock);
      if (input.observedAt > clock) throw new Error('Future intelligence observation');
      if (input.expiresAt <= clock) return null;
      const now = input.observedAt;
      let session = this.sessions.get(input.tabId);
      if (session && now <= session.lastObservedAt) return input.controlState === 'UNMONITORED' ? null : structuredClone(session);
      if (!session && now <= (this.lastEndedAt.get(input.tabId) ?? -1)) return null;
      if (session && session.expiresAt <= now) {
        this.finish(session, 'evidence_expired', session.expiresAt);
        session = undefined;
      }
      // Missing coverage is not negative evidence. Preserve the last observation only until
      // its original TTL; the tab's UNMONITORED status takes precedence in current-state UI.
      if (input.controlState === 'UNMONITORED') {
        await this.persist(clock);
        return null;
      }
      if (!hasAutomation(input.controlState)) {
        if (session) this.finish(session, 'no_evidence', now);
        await this.persist(clock);
        return null;
      }
      if (!session) {
        if (this.sessions.size >= MAX_AGENT_SESSIONS) throw new Error('Active session capacity reached');
        session = { id: crypto.randomUUID(), tabId: input.tabId, domain: input.domain,
          controlState: currentState(input, now), controller: input.controller, automationStack: input.automationStack,
          controlScore: input.controlScore, frameworkConfidence: input.frameworkConfidence, coverageScore: input.coverageScore,
          startedAt: now, lastActivityAt: input.lastActivityAt, lastObservedAt: now, expiresAt: input.expiresAt,
          endedAt: null, endReason: null, active: true, evidenceIds: input.evidenceIds, observedActivity: emptyActivity(), timeline: [] };
        this.sessions.set(input.tabId, session);
        this.event(session, 'INFERRED', 'session_started', now);
        if (session.controlState === 'AGENT_ACTIVE') this.event(session, 'INFERRED', 'session_active', now);
        else if (session.controlState === 'AGENT_CONNECTED') this.event(session, 'INFERRED', 'session_connected', now);
      } else {
        const lastActivityAt = input.lastActivityAt === null ? session.lastActivityAt :
          Math.max(session.lastActivityAt ?? 0, input.lastActivityAt);
        const state = currentState({ controlState: input.controlState, lastActivityAt }, now);
        if (session.controlState !== state) {
          if (state === 'AGENT_ACTIVE') this.event(session, 'INFERRED', 'session_active', now);
          else if (state === 'AGENT_CONNECTED') this.event(session, 'INFERRED', 'session_connected', now);
        }
        if (JSON.stringify(session.evidenceIds) !== JSON.stringify(input.evidenceIds) || session.controlScore !== input.controlScore) {
          this.event(session, 'INFERRED', 'evidence_updated', now);
        }
        if (session.coverageScore !== input.coverageScore) this.event(session, 'OBSERVED', 'coverage_changed', now);
        session.domain = input.domain;
        session.controlState = state;
        session.controller = input.controller;
        session.automationStack = input.automationStack;
        session.controlScore = input.controlScore;
        session.frameworkConfidence = input.frameworkConfidence;
        session.coverageScore = input.coverageScore;
        session.evidenceIds = input.evidenceIds;
        session.lastObservedAt = now;
        session.expiresAt = input.expiresAt;
        // A missing sample does not fabricate activity or erase a known last activity time.
        if (input.lastActivityAt !== null) session.lastActivityAt = Math.max(session.lastActivityAt ?? 0, input.lastActivityAt);
      }
      for (const key of ACTIVITY_KEYS) session.observedActivity[key] = Math.min(MAX_ACTIVITY_COUNT, session.observedActivity[key] + input.activityDelta[key]);
      if (input.activityDelta.navigations > 0) this.event(session, 'OBSERVED', 'navigation_observed', now);
      if (input.evidenceIds.includes('behavior:background-interaction') &&
          ACTIVITY_KEYS.some(key => key !== 'navigations' && input.activityDelta[key] > 0)) this.event(session, 'OBSERVED', 'background_interaction', now);
      await this.persist(clock);
      return structuredClone(session);
    });
  }

  endTab(tabId: number, reason: NonNullable<AgentSession['endReason']>, now: number): Promise<void> {
    return this.serialize(async () => {
      requireTimestamp(now);
      if (!timestamp(tabId) || tabId > 2_147_483_647) throw new Error('Invalid session tab');
      if (!(END_REASONS as readonly string[]).includes(reason)) throw new Error('Invalid session end reason');
      const session = this.sessions.get(tabId);
      if (session) this.finish(session, reason, now);
      await this.persist(now);
    });
  }

  expire(now: number): Promise<void> {
    return this.serialize(async () => {
      requireTimestamp(now);
      for (const session of this.sessions.values()) {
        if (session.expiresAt <= now) this.finish(session, 'evidence_expired', session.expiresAt);
        else if (currentState(session, now) !== session.controlState) {
          session.controlState = 'AGENT_CONNECTED';
          this.event(session, 'INFERRED', 'session_connected', now);
        }
      }
      await this.persist(now);
    });
  }

  /** Last observations within TTL, not a coverage guarantee. Current UNMONITORED tab state takes precedence. */
  snapshot(now: number): AgentSession[] {
    requireTimestamp(now);
    return [...this.sessions.values()].filter(session => session.expiresAt > now).map(session =>
      structuredClone({ ...session, controlState: currentState(session, now) }));
  }

  history(): AgentSession[] {
    const now = this.now();
    requireTimestamp(now);
    return structuredClone(this.retained(now));
  }

  clearHistory(): Promise<void> {
    return this.serialize(async () => {
      this.ended.clear();
      // Also remove terminal recovery records, otherwise load could restore deliberately cleared history.
      await this.persist(this.now());
    });
  }

  appendTimeline(sessionId: string, kind: TimelineKind, type: SessionTimelineEvent['type'], now = this.now()): Promise<boolean> {
    return this.serialize(async () => {
      requireTimestamp(now);
      if (!TIMELINE_KINDS.includes(kind) || !Object.hasOwn(SAFE_TIMELINE_DESCRIPTIONS, type)) throw new Error('Invalid timeline event');
      const session = [...this.sessions.values()].find(item => item.id === sessionId);
      if (!session || session.expiresAt <= now) return false;
      this.event(session, kind, type, now);
      await this.persist(now);
      return true;
    });
  }
}
