import type { DebuggerSnapshot } from './browser';
import { normalizeDomain } from '../shared/domains';
import type { DebuggerIntelligenceData, DebuggerIntelligenceView, DebuggerTargetRecord, DebuggerTargetType, DebuggerTransitionType } from '../shared/intelligence';
export type { DebuggerIntelligenceData, DebuggerIntelligenceView, DebuggerTargetRecord, DebuggerTargetTransition, DebuggerTargetType, DebuggerTargetView, DebuggerTransitionType } from '../shared/intelligence';

export const MAX_DEBUGGER_TARGETS = 1000;
export const MAX_DEBUGGER_TRANSITIONS = 8;
export const DEBUGGER_OBSERVATION_TTL_MS = 90_000;
const MAX_INPUT_TARGETS = 10_000;
const TARGET_TYPES = ['page', 'background_page', 'worker', 'service_worker', 'other'] as const;
const TRANSITIONS = ['target_seen', 'attachment_observed', 'detachment_observed', 'target_disappeared', 'coverage_lost', 'coverage_restored'] as const;
export interface DebuggerIntelligencePort {
  read(): Promise<unknown>;
  write(data: DebuggerIntelligenceData): Promise<void>;
}
const empty = (): DebuggerIntelligenceData => ({ schemaVersion: 1, coverageAvailable: false, lastCapturedAt: null, targets: [] });
const RECORD_KEYS = ['targetId', 'type', 'tabId', 'domain', 'attached', 'owner', 'firstSeen', 'lastSeen',
  'lastObservedAttachedChange', 'disappearedAt', 'sampledAttachmentStartedAt', 'sampledAttachmentSpanMs', 'timeline'];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function timestamp(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function targetId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value); }
function targetType(value: unknown): value is DebuggerTargetType { return typeof value === 'string' && (TARGET_TYPES as readonly string[]).includes(value); }
function tabId(value: unknown): value is number { return timestamp(value) && value <= 2_147_483_647; }
function domain(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.startsWith('*.')) return false;
  try { return normalizeDomain(value) === value; } catch { return false; }
}

function validTarget(value: unknown, capturedAt: number): value is DebuggerTargetRecord {
  if (!record(value) || !exactKeys(value, RECORD_KEYS) || !targetId(value.targetId) || !targetType(value.type) ||
      (value.tabId !== null && !tabId(value.tabId)) || !domain(value.domain) || (value.tabId === null && value.domain !== null) ||
      typeof value.attached !== 'boolean' || value.owner !== 'unknown' || !timestamp(value.firstSeen) ||
      !timestamp(value.lastSeen) || value.lastSeen < value.firstSeen || value.lastSeen > capturedAt ||
      !timestamp(value.lastObservedAttachedChange) || value.lastObservedAttachedChange < value.firstSeen || value.lastObservedAttachedChange > value.lastSeen ||
      (value.disappearedAt !== null && (!timestamp(value.disappearedAt) || value.disappearedAt <= value.lastSeen || value.disappearedAt > capturedAt)) ||
      !timestamp(value.sampledAttachmentSpanMs) || !Array.isArray(value.timeline) || !value.timeline.length || value.timeline.length > MAX_DEBUGGER_TRANSITIONS) return false;
  if (value.attached) {
    if (!timestamp(value.sampledAttachmentStartedAt) || value.sampledAttachmentStartedAt < value.firstSeen ||
        value.sampledAttachmentStartedAt > value.lastSeen || value.sampledAttachmentSpanMs !== value.lastSeen - value.sampledAttachmentStartedAt) return false;
  } else if (value.sampledAttachmentStartedAt !== null || value.sampledAttachmentSpanMs !== 0) return false;
  let previous = value.firstSeen;
  return value.timeline.every(event => {
    if (!record(event) || !exactKeys(event, ['type', 'timestamp']) || typeof event.type !== 'string' ||
        !(TRANSITIONS as readonly string[]).includes(event.type) || !timestamp(event.timestamp) || event.timestamp < previous || event.timestamp > capturedAt) return false;
    previous = event.timestamp;
    return true;
  });
}

/** Corrupt session state fails closed as a whole; unsupported claims are not sanitized into validity. */
export function parseDebuggerIntelligence(value: unknown, now: number): DebuggerIntelligenceData | null {
  if (!timestamp(now) || !record(value) || !exactKeys(value, ['schemaVersion', 'coverageAvailable', 'lastCapturedAt', 'targets']) ||
      value.schemaVersion !== 1 || typeof value.coverageAvailable !== 'boolean' || !Array.isArray(value.targets) || value.targets.length > MAX_DEBUGGER_TARGETS) return null;
  if (value.lastCapturedAt === null) return !value.coverageAvailable && value.targets.length === 0 ? empty() : null;
  if (!timestamp(value.lastCapturedAt) || value.lastCapturedAt > now) return null;
  const capturedAt = value.lastCapturedAt;
  if (!value.targets.every(item => validTarget(item, capturedAt)) || new Set(value.targets.map(item => item.targetId)).size !== value.targets.length) return null;
  return structuredClone(value as unknown as DebuggerIntelligenceData);
}

function transition(target: DebuggerTargetRecord, type: DebuggerTransitionType, timestamp: number): void {
  const previous = target.timeline.at(-1);
  if (previous?.type === type && previous.timestamp === timestamp) return;
  target.timeline.push({ type, timestamp });
  if (target.timeline.length > MAX_DEBUGGER_TRANSITIONS) target.timeline.splice(0, target.timeline.length - MAX_DEBUGGER_TRANSITIONS);
}

/** Passive, sampled inventory only. This module never accesses Chrome or alters detector scores. */
export class DebuggerIntelligenceStore {
  private data = empty();
  private queue: Promise<void> = Promise.resolve();
  private dirty = false;
  constructor(private readonly port: DebuggerIntelligencePort, private readonly options: { now?: () => number } = {}) {}

  private now(): number {
    const now = (this.options.now ?? Date.now)();
    if (!timestamp(now)) throw new Error('Invalid debugger observation clock');
    return now;
  }
  private serialize(work: () => Promise<void>): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.dirty) await this.persist();
      await work();
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private async persist(): Promise<void> {
    this.dirty = true;
    await this.port.write(structuredClone(this.data));
    this.dirty = false;
  }

  load(): Promise<void> {
    return this.serialize(async () => {
      this.data = parseDebuggerIntelligence(await this.port.read(), this.now()) ?? empty();
    });
  }

  reconcile(snapshot: DebuggerSnapshot, domains: ReadonlyMap<number, string | null>): Promise<void> {
    // Copy the trusted adapter's allowlisted fields before queueing. Raw error reasons and
    // additional URL/title fields are deliberately never retained, including in errors.
    if (!record(snapshot) || !timestamp(snapshot.capturedAt) || typeof snapshot.available !== 'boolean' ||
        !Array.isArray(snapshot.targets) || snapshot.targets.length > MAX_INPUT_TARGETS) return Promise.reject(new Error('Invalid debugger snapshot'));
    const capturedAt = snapshot.capturedAt;
    const available = snapshot.available;
    const targets: Array<Pick<DebuggerTargetRecord, 'targetId' | 'type' | 'tabId' | 'domain' | 'attached'>> = [];
    const seen = new Set<string>();
    if (available) for (const target of snapshot.targets) {
      if (!record(target) || !targetId(target.id) || !targetType(target.type) || typeof target.attached !== 'boolean' ||
          (target.tabId !== undefined && !tabId(target.tabId)) || seen.has(target.id)) return Promise.reject(new Error('Invalid debugger target snapshot'));
      const id = target.tabId ?? null;
      const suppliedDomain = id === null ? null : domains.get(id) ?? null;
      if (!domain(suppliedDomain)) return Promise.reject(new Error('Invalid debugger domain'));
      seen.add(target.id);
      targets.push({ targetId: target.id, type: target.type, tabId: id, domain: suppliedDomain, attached: target.attached });
    }
    return this.serialize(async () => {
      if (capturedAt > this.now()) throw new Error('Future debugger snapshot');
      if (this.data.lastCapturedAt !== null && capturedAt <= this.data.lastCapturedAt) return;
      const next = structuredClone(this.data);
      const previousCoverage = next.coverageAvailable;
      const records = new Map(next.targets.map(target => [target.targetId, target]));
      if (previousCoverage !== available) for (const target of records.values()) transition(target, available ? 'coverage_restored' : 'coverage_lost', capturedAt);
      if (available) {
        for (const input of targets) {
          const prior = records.get(input.targetId);
          if (!prior || prior.type !== input.type || prior.tabId !== input.tabId) {
            const fresh: DebuggerTargetRecord = { ...input, owner: 'unknown', firstSeen: capturedAt, lastSeen: capturedAt,
              lastObservedAttachedChange: capturedAt, disappearedAt: null,
              sampledAttachmentStartedAt: input.attached ? capturedAt : null, sampledAttachmentSpanMs: 0, timeline: [] };
            transition(fresh, 'target_seen', capturedAt);
            if (input.attached) transition(fresh, 'attachment_observed', capturedAt);
            records.set(input.targetId, fresh);
            continue;
          }
          const samplingContinues = previousCoverage && prior.disappearedAt === null && capturedAt - prior.lastSeen < DEBUGGER_OBSERVATION_TTL_MS;
          if (prior.disappearedAt !== null) transition(prior, 'target_seen', capturedAt);
          if (prior.attached !== input.attached) {
            prior.lastObservedAttachedChange = capturedAt;
            transition(prior, input.attached ? 'attachment_observed' : 'detachment_observed', capturedAt);
          }
          const sampledStart = input.attached ? samplingContinues && prior.attached ? prior.sampledAttachmentStartedAt ?? capturedAt : capturedAt : null;
          Object.assign(prior, input, { lastSeen: capturedAt, disappearedAt: null,
            sampledAttachmentStartedAt: sampledStart, sampledAttachmentSpanMs: sampledStart === null ? 0 : capturedAt - sampledStart });
        }
        for (const target of records.values()) if (!seen.has(target.targetId) && target.disappearedAt === null) {
          target.disappearedAt = capturedAt;
          transition(target, 'target_disappeared', capturedAt);
        }
      }
      next.coverageAvailable = available;
      next.lastCapturedAt = capturedAt;
      // Prefer the newest live targets over disappeared history; stable ties preserve source order.
      next.targets = [...records.values()].sort((left, right) => Number(left.disappearedAt !== null) - Number(right.disappearedAt !== null) || right.lastSeen - left.lastSeen).slice(0, MAX_DEBUGGER_TARGETS);
      this.data = next;
      await this.persist();
    });
  }

  snapshot(now = this.now()): DebuggerIntelligenceView {
    if (!timestamp(now)) throw new Error('Invalid debugger observation clock');
    const coverageAvailable = this.data.coverageAvailable && this.data.lastCapturedAt !== null &&
      now >= this.data.lastCapturedAt && now - this.data.lastCapturedAt < DEBUGGER_OBSERVATION_TTL_MS;
    return { coverageAvailable, lastCapturedAt: this.data.lastCapturedAt, targets: this.data.targets.map(target => {
      const observationFresh = coverageAvailable && target.disappearedAt === null && now >= target.lastSeen && now - target.lastSeen < DEBUGGER_OBSERVATION_TTL_MS;
      return { ...structuredClone(target), observationFresh, currentAttached: observationFresh ? target.attached : null };
    }) };
  }
}
