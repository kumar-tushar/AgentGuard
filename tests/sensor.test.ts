// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSensor } from '../src/content/sensor';
import { activityFromSignal, parseSensorSignal, sensorSender, SensorGate, type SensorSignal } from '../src/background/sensor-messages';

const NOW = 1_800_000_000_000;
function signal(patch: Partial<SensorSignal> = {}): SensorSignal {
  return { type: 'SENSOR_SIGNAL', schemaVersion: 1, sequence: 1, reason: 'ready', observedAt: NOW,
    visibility: 'visible', counts: { pointer: 0, keyboard: 0, input: 0, submit: 0, scroll: 0, focus: 0, trusted: 0, synthetic: 0, hiddenTrusted: 0 },
    lastActivityAt: null, ...patch };
}
const sender = { id: 'ours', frameId: 0, documentId: 'doc-1', documentLifecycle: 'active', url: 'https://example.com/private', tab: { id: 7 } } as chrome.runtime.MessageSender;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  Reflect.deleteProperty(globalThis, '__agentguardSensorV2__'); });

describe('document-bound sensor ingress', () => {
  it('accepts only own extension top-frame active HTTP(S) document senders', () => {
    expect(sensorSender(sender, 'ours')).toEqual({ tabId: 7, documentId: 'doc-1' });
    for (const patch of [{ id: 'other' }, { frameId: 2 }, { documentId: undefined }, { documentLifecycle: 'prerender' },
      { url: 'chrome://settings' }, { url: 'chrome-extension://ours/popup.html' }, { tab: undefined }, { tab: { id: 2_147_483_648 } }]) {
      expect(sensorSender({ ...sender, ...patch } as chrome.runtime.MessageSender, 'ours')).toBeNull();
    }
  });
  it('rejects stale, future, oversized, malformed and secret-bearing messages', () => {
    expect(parseSensorSignal(signal(), NOW)).toEqual(signal());
    for (const patch of [{ observedAt: NOW - 10_001 }, { observedAt: NOW + 1001 }, { sequence: -1 }, { sequence: 1.2 },
      { visibility: 'private' }, { password: 'SECRET' }, { counts: { ...signal().counts, key: 'SECRET' } },
      { counts: { ...signal().counts, keyboard: 65 } }, { counts: { ...signal().counts, hiddenTrusted: 1 } },
      { lastActivityAt: NOW + 1 }]) expect(parseSensorSignal({ ...signal(), ...patch }, NOW)).toBeNull();
  });
  it('bounds and deduplicates each document independently without conflating tabs', () => {
    const gate = new SensorGate();
    expect(gate.accept(1, 'doc-1', signal(), NOW)).toBe(true);
    expect(gate.accept(1, 'doc-1', signal(), NOW + 2000)).toBe(false);
    expect(gate.accept(1, 'doc-1', signal({ sequence: 2 }), NOW + 1)).toBe(false);
    expect(gate.accept(2, 'doc-2', signal(), NOW)).toBe(true);
    expect(gate.accept(1, 'doc-new', signal(), NOW + 2000)).toBe(true);
    for (let tabId = 3; tabId <= 1100; tabId++) gate.accept(tabId, 'doc', signal(), NOW);
    expect(Reflect.get(gate, 'entries').size).toBe(1000);
    gate.forget(1100);
    expect(Reflect.get(gate, 'entries').size).toBe(999);
  });
  it('maps only allowed count buckets into session activity', () => {
    expect(activityFromSignal(signal({ counts: { ...signal().counts, pointer: 2, keyboard: 1, input: 1, synthetic: 1 } }))).toEqual({
      navigations: 0, pointerInteractions: 2, keyboardInteractions: 1, inputInteractions: 1, scrolls: 0, submits: 0, syntheticInteractions: 1,
    });
  });
});

describe('automatic isolated sensor', () => {
  it('starts without UI, installs once, batches events, caps counts and never reads private event fields', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const listeners = new Map<string, EventListener>();
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener) => { listeners.set(type, listener as EventListener); });
    vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
    const sendMessage = vi.fn(async (_message: unknown) => ({ ok: true, monitoringEnabled: true, behaviorEnabled: true }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    installSensor();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SENSOR_SIGNAL', reason: 'ready' }));
    const installedCount = listeners.size;
    installSensor();
    expect(listeners.size).toBe(installedCount);
    const privateEvent = new Proxy({ isTrusted: true }, { get: (target, key) => {
      if (key !== 'isTrusted') throw new Error(`Private property accessed: ${String(key)}`);
      return target.isTrusted;
    } }) as Event;
    for (let i = 0; i < 100; i++) listeners.get('keydown')!(privateEvent);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const payload = sendMessage.mock.calls[1]![0] as unknown as SensorSignal;
    expect(payload.counts.keyboard).toBe(64);
    expect(payload.counts.trusted).toBe(64);
    expect(parseSensorSignal(payload, Date.now())).not.toBeNull();
    expect(JSON.stringify(payload)).not.toMatch(/password|selector|coordinate|PRIVATE/);
  });
  it('does not collect activity without a valid enabled configuration acknowledgement', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const listeners = new Map<string, EventListener>();
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener) => { listeners.set(type, listener as EventListener); });
    vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
    const sendMessage = vi.fn(async (_message: unknown) => ({ ok: true, monitoringEnabled: false, behaviorEnabled: true }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    installSensor(); await Promise.resolve();
    listeners.get('click')!({ isTrusted: true } as Event);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({ lastActivityAt: null, counts: signal().counts });
  });
});
