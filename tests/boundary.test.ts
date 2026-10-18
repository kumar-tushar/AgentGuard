// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installInteractionBoundary, installApiBoundary, grantBoundaryOnce } from '../src/content/boundary';
import type { BoundaryRule } from '../src/shared/controls';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('best-effort interaction boundaries', () => {
  it('blocks only declared synthetic event capabilities and expires without reading sensitive event fields', () => {
    const rule: BoundaryRule = { revision: 1, expiresAt: Date.now() + 1000, blocked: ['click'], blockedDomains: [], allowedDomains: [] };
    installInteractionBoundary(rule);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { get() { throw new Error('must not read target'); } });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const allowance = { id: crypto.randomUUID(), capability: 'click' as const, expiresAt: Date.now() + 500 };
    expect(grantBoundaryOnce(allowance, 'interaction')).toBe(true);
    const allowed = new MouseEvent('click', { cancelable: true }); document.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
    expect(grantBoundaryOnce(allowance, 'interaction')).toBe(false);
    const twice = new MouseEvent('click', { cancelable: true }); document.dispatchEvent(twice);
    expect(twice.defaultPrevented).toBe(true);
    installInteractionBoundary({ ...rule, revision: 2, expiresAt: Date.now() - 1 });
    const after = new MouseEvent('click', { cancelable: true }); document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
  it('keeps ordinary page API calls working without an automation stack', async () => {
    const fetch = vi.fn(async () => new Response('fixture'));
    vi.stubGlobal('fetch', fetch);
    installApiBoundary({ revision: 1, expiresAt: Date.now() + 1000, blocked: ['network'], blockedDomains: [], allowedDomains: [] });
    await window.fetch('https://example.com');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('invalidates an unused exception after control revision changes and enforces token expiry', () => {
    const now = Date.now();
    const rule: BoundaryRule = { revision: 10, expiresAt: now + 10_000, blocked: ['click'], blockedDomains: [], allowedDomains: [] };
    installInteractionBoundary(rule);
    expect(grantBoundaryOnce({ id: crypto.randomUUID(), capability: 'click', expiresAt: now + 1000 }, 'interaction')).toBe(true);
    installInteractionBoundary({ ...rule, revision: 11 });
    const changed = new MouseEvent('click', { cancelable: true }); document.dispatchEvent(changed); expect(changed.defaultPrevented).toBe(true);
    expect(grantBoundaryOnce({ id: crypto.randomUUID(), capability: 'click', expiresAt: now - 1 }, 'interaction')).toBe(false);
    installInteractionBoundary({ ...rule, revision: 12, blocked: [] });
  });
});
