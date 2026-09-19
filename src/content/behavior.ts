/**
 * Inject in the ISOLATED world. This function and its event handler never read
 * event targets, keyboard data, coordinates, text, DOM contents, or form data.
 */
export function collectBehavior(enabled: boolean, now: number): {
  trustedEvents: number;
  syntheticEvents: number;
  intervalSamples: number;
  meanIntervalMs: number;
  intervalVariance: number;
  lastTrustedAt: number | null;
  startedAt: number;
} | null {
  type Sample = { at: number; trusted: boolean };
  type State = {
    startedAt: number;
    expiresAt: number;
    samples: Sample[];
    handler: EventListener;
    timer: ReturnType<typeof setTimeout> | null;
  };
  const key = '__agentguardBehaviorCollectorV1__';
  const scope = globalThis as typeof globalThis & { [key: string]: State | undefined };
  const windowMs = 60_000;
  const idleMs = 100_000;
  const maxSamples = 64;
  const currentTime = Number.isFinite(now) ? now : Date.now();

  const teardown = (state: State): void => {
    document.removeEventListener('click', state.handler, true);
    document.removeEventListener('scroll', state.handler, true);
    if (state.timer !== null) clearTimeout(state.timer);
    if (scope[key] === state) delete scope[key];
  };
  let state = scope[key];
  if (!enabled) {
    if (state) teardown(state);
    return null;
  }
  if (state && currentTime >= state.expiresAt) {
    teardown(state);
    state = undefined;
  }
  if (!state) {
    const fresh: State = {
      startedAt: currentTime,
      expiresAt: currentTime + idleMs,
      samples: [],
      handler: () => undefined,
      timer: null,
    };
    fresh.handler = (event: Event): void => {
      const at = Date.now();
      if (at >= fresh.expiresAt) {
        teardown(fresh);
        return;
      }
      fresh.samples.push({ at, trusted: event.isTrusted });
      while (fresh.samples.length > maxSamples || (fresh.samples[0] && fresh.samples[0].at < at - windowMs)) {
        fresh.samples.shift();
      }
    };
    document.addEventListener('click', fresh.handler, true);
    document.addEventListener('scroll', fresh.handler, true);
    scope[key] = fresh;
    state = fresh;
  }

  state.expiresAt = currentTime + idleMs;
  if (state.timer !== null) clearTimeout(state.timer);
  const active = state;
  state.timer = setTimeout(() => teardown(active), idleMs);
  while (state.samples[0] && state.samples[0].at < currentTime - windowMs) state.samples.shift();

  const samples = state.samples;
  const trustedEvents = samples.reduce((count, sample) => count + Number(sample.trusted), 0);
  const syntheticEvents = samples.length - trustedEvents;
  let lastTrustedAt: number | null = null;
  for (const sample of samples) if (sample.trusted) lastTrustedAt = Math.min(sample.at, currentTime);
  let intervalSum = 0;
  let squaredSum = 0;
  const intervalSamples = Math.max(0, samples.length - 1);
  for (let index = 1; index < samples.length; index += 1) {
    const interval = Math.max(0, samples[index]!.at - samples[index - 1]!.at);
    intervalSum += interval;
    squaredSum += interval * interval;
  }
  const meanIntervalMs = intervalSamples ? intervalSum / intervalSamples : 0;
  const intervalVariance = intervalSamples ? Math.max(0, squaredSum / intervalSamples - meanIntervalMs ** 2) : 0;
  return {
    trustedEvents,
    syntheticEvents,
    intervalSamples,
    meanIntervalMs,
    intervalVariance,
    lastTrustedAt,
    startedAt: Math.max(state.startedAt, currentTime - windowMs),
  };
}
