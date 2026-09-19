/**
 * This function is serialized by chrome.scripting and runs in the MAIN world.
 * Keep it self-contained and return only allowlisted primitive observations.
 */
export function collectRuntime(): { webdriver: boolean | null; fingerprints: string[] } {
  let webdriver: boolean | null = null;
  try {
    const value: unknown = navigator.webdriver;
    if (typeof value === 'boolean') webdriver = value;
  } catch {
    // A hostile page may replace the getter. Unknown is not a clean result.
  }

  const fingerprints: string[] = [];
  const hasOwn = (name: string): boolean => {
    try {
      return Object.prototype.hasOwnProperty.call(globalThis, name);
    } catch {
      return false;
    }
  };
  if (hasOwn('__playwright__binding__')) fingerprints.push('playwright-binding');
  if (hasOwn('__pwInitScripts')) fingerprints.push('playwright-init');
  if (hasOwn('__selenium_unwrapped') || hasOwn('__selenium_evaluate')) fingerprints.push('selenium-global');
  if (hasOwn('__webdriver_evaluate') || hasOwn('__webdriver_script_fn')) fingerprints.push('webdriver-global');
  return { webdriver, fingerprints };
}
