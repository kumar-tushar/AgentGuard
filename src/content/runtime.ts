import type { FingerprintProbe } from '../shared/fingerprints';

/**
 * This function is serialized by chrome.scripting and runs in the MAIN world.
 * Keep it self-contained and return only allowlisted primitive observations.
 */
export function collectRuntime(probes: readonly FingerprintProbe[], stackEnabled = false): { webdriver: boolean | null; fingerprints: string[] | null } {
  let webdriver: boolean | null = null;
  try {
    const value: unknown = navigator.webdriver;
    if (typeof value === 'boolean') webdriver = value;
  } catch {
    // A hostile page may replace the getter. Unknown is not a clean result.
  }

  const fingerprints: string[] = [];
  let markersAvailable = true;
  const hasOwn = (name: string): boolean => {
    try {
      return Object.prototype.hasOwnProperty.call(globalThis, name);
    } catch {
      markersAvailable = false;
      return false;
    }
  };
  for (const probe of probes) {
    if (probe.ownGlobals.some(hasOwn)) fingerprints.push(probe.id);
  }
  // Optional compatibility-sensitive interception. Stacks are matched locally,
  // then discarded; only two packaged labels and observation times are retained.
  try {
    type StackProbe = { refresh(enabled: boolean): void; read(): string[] };
    const scope = globalThis as typeof globalThis & { __agentguardStackProbeV1__?: StackProbe };
    if (!scope.__agentguardStackProbeV1__ && stackEnabled) {
      let expiresAt = Date.now() + 90_000;
      const seen = new Map<string, number>();
      const note = () => {
        if (expiresAt <= Date.now()) return;
        const stack = new Error().stack ?? '';
        if (/\bUtilityScript\.(?:evaluate|callFunction)\b/u.test(stack)) seen.set('playwright-stack', Date.now());
        if (/pptr:(?:evaluate|evaluateHandle)|__puppeteer_evaluation_script__/u.test(stack)) seen.set('puppeteer-stack', Date.now());
      };
      const wrap = (object: object, key: string) => {
        const original: unknown = Reflect.get(object, key);
        if (typeof original !== 'function') return;
        Reflect.set(object, key, function(this: unknown, ...args: unknown[]) { note(); return Reflect.apply(original, this, args); });
      };
      wrap(window, 'fetch'); wrap(window, 'open');
      wrap(XMLHttpRequest.prototype, 'open'); wrap(navigator, 'sendBeacon');
      wrap(Element.prototype, 'insertAdjacentHTML');
      scope.__agentguardStackProbeV1__ = {
        refresh(enabled) { expiresAt = enabled ? Date.now() + 90_000 : 0; if (!enabled) seen.clear(); },
        read() { return [...seen].filter(([, timestamp]) => expiresAt > Date.now() && timestamp > Date.now() - 90_000).map(([marker]) => marker); },
      };
    }
    const probe = scope.__agentguardStackProbeV1__;
    probe?.refresh(stackEnabled);
    if (stackEnabled) for (const marker of probe?.read() ?? []) if (['playwright-stack', 'puppeteer-stack'].includes(marker) && !fingerprints.includes(marker)) fingerprints.push(marker);
  } catch { markersAvailable = false; }
  return { webdriver, fingerprints: markersAvailable ? fingerprints : null };
}
