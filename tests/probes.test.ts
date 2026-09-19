import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectBehavior } from '../src/content/behavior';
import { collectRuntime } from '../src/content/runtime';

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
    expect(collectRuntime()).toEqual({ webdriver: true, fingerprints: ['playwright-binding'] });
    vi.stubGlobal('navigator', { get webdriver() { throw new Error('hostile getter'); } });
    expect(collectRuntime().webdriver).toBeNull();
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
