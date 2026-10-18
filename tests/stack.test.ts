// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { collectRuntime } from '../src/content/runtime';
import { FINGERPRINT_PROBES } from '../src/shared/fingerprints';

describe('optional fixed-label stack hints', () => {
  it('does not mistake ordinary callFunction names for Selenium and discards full stacks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('fixture')));
    collectRuntime(FINGERPRINT_PROBES, true);
    await (function callFunction() { return window.fetch('https://example.com/SECRET'); })();
    expect(collectRuntime(FINGERPRINT_PROBES, true).fingerprints).toEqual([]);
    await new Function('return fetch("https://example.com/PRIVATE")\n//# sourceURL=pptr:evaluate;fixture')();
    const result = collectRuntime(FINGERPRINT_PROBES, true);
    expect(result.fingerprints).toContain('puppeteer-stack');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET|pptr:/);
    expect(collectRuntime(FINGERPRINT_PROBES, false).fingerprints).not.toContain('puppeteer-stack');
    vi.unstubAllGlobals();
  });
});
