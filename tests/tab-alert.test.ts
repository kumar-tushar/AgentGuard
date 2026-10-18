// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTabAlert, type TabAlertPresentation, type TabAlertStack } from '../src/content/tab-alert';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const presentation = (patch: Partial<TabAlertPresentation> = {}): TabAlertPresentation => ({
  state: 'AUTOMATION_LIKELY', confidence: 0.82, assessedAt: NOW, expiresAt: NOW + 90_000, token: 'token-1', tabId: 1, domain: 'example.com', ...patch,
});
let revision = 0;
const stack = (alerts = [presentation()], sequence = ++revision): TabAlertStack => ({ revision: sequence, alerts });
const render = (value: TabAlertPresentation | null) => renderTabAlert(value === null ? null : stack([value]));
const container = () => document.querySelector<HTMLDivElement>('[data-agentguard-alert-stack]');
const alert = () => document.querySelector<HTMLDivElement>('[data-agentguard-alert]');
beforeEach(() => { revision = 0; vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => {
  document.querySelectorAll('[data-agentguard-alert-stack]').forEach(element => element.remove());
  Reflect.deleteProperty(globalThis, '__agentguardTabAlertV2__');
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('isolated top-right tab alert', () => {
  it('renders a compact accessible, qualified notice without exposing its token or collecting page data', () => {
    const attach = vi.spyOn(Element.prototype, 'attachShadow');
    render(presentation());
    const host = alert()!;
    const shadow = attach.mock.results[0]!.value as ShadowRoot;
    expect(host.getAttribute('role')).toBe('button');
    expect(host.tabIndex).toBe(0);
    expect(host.getAttribute('aria-label')).toContain('Automation likely');
    expect(host.getAttribute('aria-label')).toContain('Evidence score: 82%');
    expect(host.shadowRoot).toBeNull();
    expect(container()!.style.position).toBe('fixed');
    expect(container()!.style.right).toBe('16px');
    expect(container()!.style.maxWidth).toBe('calc(100vw - 32px)');
    expect(shadow.textContent).toContain('Controller identity unverified.');
    expect(shadow.querySelector('style')?.textContent).toContain('background:#141b25');
    expect(shadow.querySelector('style')?.textContent).toContain('outline:3px solid #63dbb2');
    expect(shadow.textContent).toContain('example.com · Tab 1');
    expect(shadow.textContent).not.toMatch(/Click to hide|24 hours/);
    expect(host.getAttribute('aria-label')).toContain('Switch to tab 1.');
    expect(shadow.textContent).not.toContain('token-1');
    expect(host.outerHTML).not.toContain('token-1');
    expect(host.outerHTML).not.toContain('example.com');
  });

  it.each([
    ['AGENT_ACTIVE', 'Agent activity detected'], ['AGENT_CONNECTED', 'Agent connection detected'],
    ['AUTOMATION_LIKELY', 'Automation likely'], ['AUTOMATION_SUSPECTED', 'Automation suspected'],
  ] as const)('uses qualified wording for %s', (state, label) => {
    render(presentation({ state }));
    expect(alert()!.getAttribute('aria-label')).toContain(label);
  });

  it('renews the same host without duplicates or moving keyboard focus', async () => {
    render(presentation());
    const host = alert()!;
    host.focus();
    await vi.advanceTimersByTimeAsync(1000);
    render(presentation({ assessedAt: NOW + 1000, expiresAt: NOW + 91_000, confidence: 0.93 }));
    expect(alert()).toBe(host);
    expect(document.activeElement).toBe(host);
    expect(document.querySelectorAll('[data-agentguard-alert]')).toHaveLength(1);
    expect(host.getAttribute('aria-label')).toContain('93%');
    await vi.advanceTimersByTimeAsync(89_001);
    expect(alert()).toBe(host);
    await vi.advanceTimersByTimeAsync(1000);
    expect(alert()).toBeNull();
  });

  it('ignores invalid, stale, oversized, future and out-of-order presentations', () => {
    render(presentation());
    for (const patch of [
      { state: 'HUMAN' }, { confidence: NaN }, { confidence: -0.1 }, { confidence: 1.1 },
      { assessedAt: NOW + 1 }, { assessedAt: NOW - 1 }, { expiresAt: NOW }, { expiresAt: NOW + 90_001 },
      { token: 'private/token' }, { token: 'a'.repeat(129) }, { token: '' }, { password: 'private' },
    ]) render({ ...presentation(), ...patch } as TabAlertPresentation);
    expect(alert()!.getAttribute('aria-label')).toContain('82%');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('hides on null and accepts a newer serialized update even in the same millisecond', () => {
    render(presentation());
    render(null);
    expect(alert()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    render(presentation({ token: 'token-2' }));
    expect(alert()).not.toBeNull();
  });

  it('never allows a synthetic page click or keyboard event to dismiss the alert', () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    render(presentation());
    alert()!.click();
    alert()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    alert()!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(alert()).not.toBeNull();
  });

  it.each(['click', 'Enter', ' '] as const)('hides only after a trusted %s gets a valid acknowledgement and suppresses queued updates', async kind => {
    let acknowledge!: (value: unknown) => void;
    const sendMessage = vi.fn(() => new Promise(resolve => { acknowledge = resolve; }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const listeners = vi.spyOn(EventTarget.prototype, 'addEventListener');
    render(presentation());
    const eventType = kind === 'click' ? 'click' : 'keydown';
    const callIndex = listeners.mock.calls.findIndex((call, index) => call[0] === eventType && listeners.mock.contexts[index] === alert());
    const listener = listeners.mock.calls[callIndex]![1] as EventListener;
    const event = { type: eventType, key: kind, isTrusted: true, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event;
    listener(event);
    listener(event);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: 'token-1' });
    expect(alert()).not.toBeNull();
    acknowledge({ ok: true, mutedUntil: NOW + DAY });
    await vi.advanceTimersByTimeAsync(0);
    expect(alert()).toBeNull();
    render(presentation());
    expect(alert()).toBeNull();
    await vi.advanceTimersByTimeAsync(DAY);
    render(presentation({ assessedAt: Date.now(), expiresAt: Date.now() + 90_000 }));
    expect(alert()).not.toBeNull();
  });

  it.each([{ ok: false }, { ok: true, mutedUntil: NOW }, { ok: true, mutedUntil: NOW + DAY + 1 }, null])('keeps the notice for rejected or malformed acknowledgement %j', async response => {
    const sendMessage = vi.fn(async () => response);
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const listeners = vi.spyOn(EventTarget.prototype, 'addEventListener');
    render(presentation());
    const index = listeners.mock.calls.findIndex((call, offset) => call[0] === 'click' && listeners.mock.contexts[offset] === alert());
    const listener = listeners.mock.calls[index]![1] as EventListener;
    listener({ type: 'click', isTrusted: true, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);
    await vi.advanceTimersByTimeAsync(0);
    expect(alert()).not.toBeNull();
  });

  it('ignores unrelated trusted keys and handles a disconnected extension without dismissing', async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('Extension disconnected')).mockImplementationOnce(() => { throw new Error('Extension disconnected'); });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const listeners = vi.spyOn(EventTarget.prototype, 'addEventListener');
    render(presentation());
    const index = listeners.mock.calls.findIndex((call, offset) => call[0] === 'keydown' && listeners.mock.contexts[offset] === alert());
    const listener = listeners.mock.calls[index]![1] as EventListener;
    listener({ type: 'keydown', key: 'Tab', isTrusted: true } as unknown as Event);
    expect(sendMessage).not.toHaveBeenCalled();
    const event = { type: 'keydown', key: 'Enter', isTrusted: true, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event;
    listener(event);
    await vi.advanceTimersByTimeAsync(0);
    listener(event);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(alert()).not.toBeNull();
  });

  it('is safe before documentElement exists and can install afterward', () => {
    const root = vi.spyOn(document, 'documentElement', 'get').mockReturnValue(null as unknown as HTMLElement);
    expect(() => render(presentation())).not.toThrow();
    expect(Reflect.has(globalThis, '__agentguardTabAlertV2__')).toBe(false);
    root.mockRestore();
    render(presentation());
    expect(alert()).not.toBeNull();
  });

  it('works after function serialization without module closures', () => {
    const serialized = new Function(`return (${renderTabAlert.toString()});`)() as typeof renderTabAlert;
    serialized(stack());
    expect(alert()!.getAttribute('aria-label')).toContain('Automation likely');
  });

  it('stacks distinct tab cards in snapshot order and deduplicates repeated tab IDs without replacing focused hosts', () => {
    const first = presentation();
    const second = presentation({ tabId: 2, token: 'token-2', domain: 'other.example.com' });
    renderTabAlert(stack([first, second, first]));
    const hosts = [...container()!.children];
    expect(hosts).toHaveLength(2);
    expect(container()!.style.display).toBe('flex');
    expect(container()!.style.flexDirection).toBe('column');
    expect(container()!.style.gap).toBe('8px');
    expect(container()!.style.width).toBe('300px');
    expect(container()!.style.maxHeight).toBe('calc(100vh - 32px)');
    expect(container()!.style.overflowY).toBe('auto');
    expect(hosts[0]!.getAttribute('aria-label')).toContain('Tab 1.');
    expect(hosts[1]!.getAttribute('aria-label')).toContain('Tab 2.');
    expect(container()!.outerHTML).not.toContain('example.com');
    (hosts[1] as HTMLElement).focus();
    renderTabAlert(stack([second, first]));
    expect([...container()!.children]).toEqual([hosts[1], hosts[0]]);
    expect(document.activeElement).toBe(hosts[1]);
    expect(document.querySelectorAll('[data-agentguard-alert-stack]')).toHaveLength(1);
  });

  it('removes only expired cards, retains fresh siblings, and removes an empty container', async () => {
    renderTabAlert(stack([presentation({ expiresAt: NOW + 1000 }), presentation({ tabId: 2, token: 'token-2', domain: null })]));
    const retained = document.querySelector('[data-agentguard-tab-id="2"]');
    expect(retained!.getAttribute('aria-label')).toContain('Tab 2.');
    await vi.advanceTimersByTimeAsync(1000);
    expect(container()!.children).toHaveLength(1);
    expect(alert()).toBe(retained);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(container()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('filters a stale card in an otherwise fresh stack without hiding fresh siblings', () => {
    renderTabAlert(stack([
      presentation({ assessedAt: NOW - 90_000, expiresAt: NOW }),
      presentation({ tabId: 2, token: 'token-2' }),
    ]));
    expect(container()!.children).toHaveLength(1);
    expect(alert()!.getAttribute('data-agentguard-tab-id')).toBe('2');
  });

  it('ignores duplicate and out-of-order revisions, including a stale restoration after an empty snapshot', () => {
    renderTabAlert(stack([presentation()], 5));
    renderTabAlert(stack([presentation({ confidence: 0.12 })], 5));
    renderTabAlert(stack([], 4));
    expect(alert()!.getAttribute('aria-label')).toContain('82%');
    renderTabAlert(stack([], 6));
    expect(container()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    renderTabAlert(stack([presentation()], 5));
    expect(container()).toBeNull();
    renderTabAlert(stack([presentation()], 7));
    expect(alert()).not.toBeNull();
  });

  it('does not replace a current card with an older same-tab assessment or duplicate', () => {
    render(presentation());
    const older = presentation({ assessedAt: NOW - 1000, expiresAt: NOW + 89_000, confidence: 0.2 });
    renderTabAlert(stack([older, presentation(), older]));
    expect(container()!.children).toHaveLength(1);
    expect(alert()!.getAttribute('aria-label')).toContain('82%');
  });

  it('rejects malformed envelopes and unsafe card identities atomically', () => {
    render(presentation());
    const malformed: unknown[] = [undefined, false, [], {}, { ...stack(), revision: -1 }, { ...stack(), revision: NaN },
      { ...stack(), revision: 1.5 }, { ...stack(), secret: 'PRIVATE' }, { ...stack(), alerts: {} },
      stack(Array.from({ length: 501 }, (_, tabId) => presentation({ tabId }))), stack(new Array<TabAlertPresentation>(2)),
      ...[{ domain: 'https://example.com/PRIVATE' }, { domain: 'EXAMPLE.COM' }, { domain: '' }, { domain: 'a..b' },
        { domain: 'a'.repeat(254) }, { domain: 'a'.repeat(64) + '.example' }, { domain: 'example.com.' }, { domain: 'a@b.com' },
        { tabId: -1 }, { tabId: 2_147_483_648 }, { tabId: 1.5 }].map(patch => stack([presentation(), { ...presentation({ tabId: 2 }), ...patch }])),
    ];
    for (const value of malformed) expect(() => renderTabAlert(value as TabAlertStack)).not.toThrow();
    expect(container()!.children).toHaveLength(1);
    expect(alert()!.getAttribute('aria-label')).toContain('82%');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('activates the selected middle card only and suppresses its queued rotated-token updates after acknowledgment', async () => {
    let acknowledge!: (value: unknown) => void;
    const sendMessage = vi.fn(() => new Promise(resolve => { acknowledge = resolve; }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const listeners = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const values = [1, 2, 3].map(tabId => presentation({ tabId, token: `token-${tabId}` }));
    renderTabAlert(stack(values));
    const selected = document.querySelector('[data-agentguard-tab-id="2"]');
    const index = listeners.mock.calls.findIndex((call, offset) => call[0] === 'click' && listeners.mock.contexts[offset] === selected);
    const listener = listeners.mock.calls[index]![1] as EventListener;
    listener({ type: 'click', isTrusted: true, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: 'token-2' });
    expect(container()!.children).toHaveLength(3);
    acknowledge({ ok: true, mutedUntil: NOW + DAY });
    await vi.advanceTimersByTimeAsync(0);
    expect([...container()!.children].map(host => host.getAttribute('data-agentguard-tab-id'))).toEqual(['1', '3']);
    renderTabAlert(stack(values.map(value => ({ ...value, token: 'rotated-' + value.token }))));
    expect([...container()!.children].map(host => host.getAttribute('data-agentguard-tab-id'))).toEqual(['1', '3']);
    await vi.advanceTimersByTimeAsync(DAY);
    renderTabAlert(stack(values.map(value => ({ ...value, assessedAt: Date.now(), expiresAt: Date.now() + 90_000 }))));
    expect(container()!.children).toHaveLength(3);
  });

  it('copies card input and ignores trusted callbacks belonging to removed cards', () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const listeners = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const item = presentation();
    renderTabAlert(stack([item]));
    const index = listeners.mock.calls.findIndex((call, offset) => call[0] === 'click' && listeners.mock.contexts[offset] === alert());
    const listener = listeners.mock.calls[index]![1] as EventListener;
    item.token = 'replaced-input-token';
    item.confidence = 0;
    expect(alert()!.getAttribute('aria-label')).toContain('82%');
    renderTabAlert(stack([]));
    listener({ type: 'click', isTrusted: true, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('accepts the bounded 500-card inventory with one expiry timer and clears all cards on null', () => {
    renderTabAlert(stack(Array.from({ length: 500 }, (_, tabId) => presentation({ tabId, token: `token-${tabId}` }))));
    expect(container()!.children).toHaveLength(500);
    expect(vi.getTimerCount()).toBe(1);
    renderTabAlert(null);
    expect(container()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
