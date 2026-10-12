import type { FingerprintProbe } from '../shared/fingerprints';

/**
 * This function is serialized by chrome.scripting and runs in the MAIN world.
 * Keep it self-contained and return only allowlisted primitive observations.
 */
export function collectRuntime(probes: readonly FingerprintProbe[]): { webdriver: boolean | null; fingerprints: string[] | null } {
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
  return { webdriver, fingerprints: markersAvailable ? fingerprints : null };
}
