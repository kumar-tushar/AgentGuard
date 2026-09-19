import type { BehaviorSnapshot, DetectionContext, Fingerprint, RuntimeSnapshot } from '../shared/contracts';

const fingerprints: readonly Fingerprint[] = [
  'playwright-binding',
  'playwright-init',
  'selenium-global',
  'webdriver-global',
];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function boundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Rebuild hostile MAIN-world output from an exact, finite allowlist. */
export function normalizeRuntimeSnapshot(value: unknown): RuntimeSnapshot | null {
  try {
    const raw = record(value);
    if (!raw || !hasOnlyKeys(raw, ['webdriver', 'fingerprints'])) return null;
    const webdriver = raw.webdriver;
    const markers = raw.fingerprints;
    if (webdriver !== null && typeof webdriver !== 'boolean') return null;
    if (!Array.isArray(markers) || markers.length > fingerprints.length) return null;
    if (!markers.every(marker => typeof marker === 'string' && fingerprints.includes(marker as Fingerprint))) return null;
    if (new Set(markers).size !== markers.length) return null;
    return { webdriver, fingerprints: [...markers] as Fingerprint[] };
  } catch {
    return null;
  }
}

export const normalizeRuntime = normalizeRuntimeSnapshot;

/** Reject malformed or stale aggregate output rather than treating it as clean. */
export function normalizeBehaviorSnapshot(value: unknown, now: number): BehaviorSnapshot | null {
  try {
    if (!Number.isFinite(now)) return null;
    const raw = record(value);
    if (!raw || !hasOnlyKeys(raw, [
      'trustedEvents', 'syntheticEvents', 'intervalSamples', 'meanIntervalMs',
      'intervalVariance', 'lastTrustedAt', 'startedAt',
    ])) return null;
    const { trustedEvents, syntheticEvents, intervalSamples, meanIntervalMs, intervalVariance, lastTrustedAt, startedAt } = raw;
    if (!boundedNumber(trustedEvents, 0, 64) || !Number.isInteger(trustedEvents)) return null;
    if (!boundedNumber(syntheticEvents, 0, 64) || !Number.isInteger(syntheticEvents)) return null;
    if (trustedEvents + syntheticEvents > 64) return null;
    if (!boundedNumber(intervalSamples, 0, 63) || !Number.isInteger(intervalSamples)) return null;
    if (intervalSamples !== Math.max(0, trustedEvents + syntheticEvents - 1)) return null;
    if (!boundedNumber(meanIntervalMs, 0, 60_000)) return null;
    if (!boundedNumber(intervalVariance, 0, 3_600_000_000)) return null;
    if (!boundedNumber(startedAt, now - 60_000, now)) return null;
    if (lastTrustedAt !== null && !boundedNumber(lastTrustedAt, now - 60_000, now)) return null;
    if (trustedEvents > 0 && lastTrustedAt === null) return null;
    if (trustedEvents === 0 && lastTrustedAt !== null) return null;
    return { trustedEvents, syntheticEvents, intervalSamples, meanIntervalMs, intervalVariance, lastTrustedAt, startedAt };
  } catch {
    return null;
  }
}

export const normalizeBehavior = normalizeBehaviorSnapshot;

/** All probe data is revalidated at the detector boundary, not merely typed. */
export function normalizeDetectionContext(context: Readonly<DetectionContext>): DetectionContext {
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  return {
    now,
    runtime: normalizeRuntimeSnapshot(context.runtime),
    behavior: normalizeBehaviorSnapshot(context.behavior, now),
    debuggerAttached: typeof context.debuggerAttached === 'boolean' ? context.debuggerAttached : null,
    runtimeReason: typeof context.runtimeReason === 'string' ? context.runtimeReason.slice(0, 120) : '',
    debuggerReason: typeof context.debuggerReason === 'string' ? context.debuggerReason.slice(0, 120) : '',
  };
}
