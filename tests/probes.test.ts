import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectBehavior } from '../src/content/behavior';
import { collectRuntime } from '../src/content/runtime';
import { FINGERPRINT_PROBES, FINGERPRINT_REGISTRY, FINGERPRINT_REGISTRY_VERSION, fingerprintDefinition } from '../src/shared/fingerprints';
import { runInNewContext } from 'node:vm';

const NOW = 1_800_000_000_000;
type Listener = EventListener;

class MinimalDocument {
  readonly listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, trusted: boolean): void {
    const event = new Proxy({ isTrusted: trusted }, {
      get(target, property) {
        if (property !== 'isTrusted') throw new Error(`Sensitive event property read: ${String(property)}`);
        return target.isTrusted;
      },
    }) as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('serialized content probes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads only the WebDriver flag and fixed global marker existence', () => {
    vi.stubGlobal('navigator', { webdriver: true });
    vi.stubGlobal('__playwright__binding__', { privateData: 'do not read' });
    expect(collectRuntime(FINGERPRINT_PROBES)).toEqual({ webdriver: true, fingerprints: ['playwright-binding'] });
    vi.stubGlobal('navigator', { get webdriver() { throw new Error('hostile getter'); } });
    expect(collectRuntime(FINGERPRINT_PROBES).webdriver).toBeNull();
  });

  it.each(FINGERPRINT_PROBES.flatMap(probe => probe.ownGlobals.map(name => ({ id: probe.id, name }))))('registry property fixtures: $name is existence-only', ({ id, name }) => {
    vi.stubGlobal('navigator', { webdriver: false });
    vi.stubGlobal(name, null);
    const getter = vi.fn(() => { throw new Error('PRIVATE_MARKER_VALUE'); });
    Object.defineProperty(globalThis, name, { configurable: true, get: getter });
    expect(collectRuntime(FINGERPRINT_PROBES)).toEqual({ webdriver: false, fingerprints: [id] });
    expect(getter).not.toHaveBeenCalled();
  });

  it('serializes without module closures, ignores inherited/lookalike globals and deduplicates aliases', () => {
    const source = `(${collectRuntime.toString()})(${JSON.stringify(FINGERPRINT_PROBES)})`;
    const inherited = runInNewContext(`Object.prototype.__selenium_evaluate = true; ${source}`, {
      navigator: { webdriver: false }, __selenium_evaluate_similar: true,
    });
    expect(inherited).toEqual({ webdriver: false, fingerprints: [] });
    expect(runInNewContext(source, { navigator: { webdriver: true }, __playwright__binding__: null,
      __playwright__binding__controller__: null })).toEqual({ webdriver: true, fingerprints: ['playwright-binding'] });
  });

  it('preserves WebDriver evidence when marker inspection fails instead of claiming negative coverage', () => {
    const source = `Object.prototype.hasOwnProperty = () => { throw new Error('PRIVATE_FAILURE'); }; (${collectRuntime.toString()})(${JSON.stringify(FINGERPRINT_PROBES)})`;
    expect(runInNewContext(source, { navigator: { webdriver: true } })).toEqual({ webdriver: true, fingerprints: null });
  });

  it.each([undefined, null, 'true', 'false', 0, 1, {}, []])('treats nonboolean WebDriver values as unknown: %j', webdriver => {
    vi.stubGlobal('navigator', { webdriver });
    expect(collectRuntime(FINGERPRINT_PROBES)).toEqual({ webdriver: null, fingerprints: [] });
  });

  it('keeps registry provenance separate from observation identity and rejects prototype keys', () => {
    expect(FINGERPRINT_REGISTRY_VERSION).toBe(1);
    expect(fingerprintDefinition('__proto__')).toBeUndefined();
    expect(fingerprintDefinition('constructor')).toBeUndefined();
    expect(fingerprintDefinition({ toString: () => 'playwright-binding' })).toBeUndefined();
    for (const [id, definition] of Object.entries(FINGERPRINT_REGISTRY)) {
      expect(definition.id).toBe(id);
      expect(definition.signal.id).toBe(id);
      expect(definition.confidence).toBeGreaterThan(0);
      expect(definition.confidence).toBeLessThan(0.4);
      expect(definition.falsePositiveNotes).toContain('forge');
      expect(definition.testFixture).toMatch(/^tests\//);
      expect(definition.reliability).toBe('unverified-framework-hint');
      if (!definition.sources.length) expect(definition.lastVerifiedDate).toBeNull();
    }
  });
});

describe('bounded isolated behavior collector', () => {
  let document: MinimalDocument;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    document = new MinimalDocument();
    vi.stubGlobal('document', document);
  });
  afterEach(() => {
    collectBehavior(false, Date.now());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('records only aggregate timestamps/trust, caps samples, and never inspects targets or keys', () => {
    expect(collectBehavior(true, NOW)).toMatchObject({ trustedEvents: 0, syntheticEvents: 0 });
    for (let index = 0; index < 80; index += 1) {
      document.emit('click', index % 2 === 0);
      vi.setSystemTime(NOW + index * 10);
    }
    const result = collectBehavior(true, Date.now());
    expect(result?.trustedEvents).toBe(32);
    expect(result?.syntheticEvents).toBe(32);
    expect(result?.intervalSamples).toBe(63);
    expect(Object.keys(result ?? {}).sort()).toEqual([
      'intervalSamples', 'intervalVariance', 'lastTrustedAt', 'meanIntervalMs',
      'startedAt', 'syntheticEvents', 'trustedEvents',
    ]);
  });

  it('drops events outside a minute and removes listeners after idle expiry', () => {
    collectBehavior(true, NOW);
    document.emit('click', true);
    vi.advanceTimersByTime(61_000);
    expect(collectBehavior(true, Date.now())?.trustedEvents).toBe(0);
    expect(document.listeners.get('click')?.size).toBe(1);
    vi.advanceTimersByTime(100_001);
    expect(document.listeners.get('click')?.size).toBe(0);
    expect((globalThis as Record<string, unknown>).__agentguardBehaviorCollectorV1__).toBeUndefined();
  });

  it('tears down immediately when collection is disabled', () => {
    collectBehavior(true, NOW);
    expect(document.listeners.get('click')?.size).toBe(1);
    expect(collectBehavior(false, NOW)).toBeNull();
    expect(document.listeners.get('click')?.size).toBe(0);
  });
});
