import { afterEach, describe, expect, it, vi } from 'vitest';
import { delegationRules, DelegationEgress, EGRESS_REGEX } from '../src/background/egress';
import type { ControlGrant } from '../src/shared/controls';

const grant: ControlGrant = { id: crypto.randomUUID(), tabId: 1, preset: 'LIMITED', allowedDomains: ['example.com'], blockedDomains: ['private.example.com'], createdAt: 1000, expiresAt: 61_000 };
afterEach(() => vi.unstubAllGlobals());
describe('tab-wide delegation egress', () => {
  it('keeps explicit denials ahead of the allowlist and covers websocket handshakes', () => {
    const rules = delegationRules([grant]);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ priority: 3, condition: { tabIds: [1], requestDomains: ['private.example.com'] } });
    expect(rules[1]).toMatchObject({ priority: 2, condition: { excludedRequestDomains: ['example.com'] } });
    expect(rules[0]!.condition.resourceTypes).toContain('websocket');
    for (const url of ['http://example.com', 'https://example.com', 'ws://example.com', 'wss://example.com']) expect(new RegExp(EGRESS_REGEX).test(url)).toBe(true);
  });
  it('installs only its own rules, preserves quarantine rules and removes grants on revoke', async () => {
    let rules: chrome.declarativeNetRequest.Rule[] = [
      { id: 1_000_000, action: { type: 'block' }, condition: {} },
      { id: 2_000_000, priority: 1, action: { type: 'block' }, condition: { tabIds: [1_999_999], regexFilter: '^https?://' } },
    ] as chrome.declarativeNetRequest.Rule[];
    const update = vi.fn(async (input: chrome.declarativeNetRequest.UpdateRuleOptions) => { rules = [...rules.filter(rule => !input.removeRuleIds?.includes(rule.id)), ...(input.addRules ?? [])]; });
    vi.stubGlobal('chrome', { permissions: { getAll: async () => ({ permissions: ['declarativeNetRequestWithHostAccess'] }) }, declarativeNetRequest: { getSessionRules: async () => rules, updateSessionRules: update } });
    const store = new DelegationEgress();
    await store.reconcile([grant]); expect(store.activeTabs()).toEqual([1]);
    expect(rules.find(rule => rule.id === 2_000_000)?.condition.tabIds).toEqual([1_999_999]);
    expect(rules.filter(rule => rule.priority === 3).map(rule => rule.id)).toEqual([2_000_001]);
    await store.reconcile([]); expect(rules.map(rule => rule.id)).toEqual([1_000_000, 2_000_000]);
    expect(store.activeTabs()).toEqual([]);
  });
});
