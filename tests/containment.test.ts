import { afterEach, describe, expect, it, vi } from 'vitest';
import { Containment, chromeContainmentPort, type ContainmentPort } from '../src/background/containment';
import { SessionStore, type SessionData } from '../src/background/session';
import type { QuarantineRecord } from '../src/shared/contracts';

function setup(network = true) {
  const calls: string[] = [];
  let failWrite = false;
  let failNavigate = false;
  let failRemove = false;
  const rules = new Set<number>();
  const writes: SessionData[] = [];
  const store = new SessionStore({
    async read() { return undefined; },
    async write(data) { if (failWrite) throw new Error('storage failed'); writes.push(data); },
  });
  const port: ContainmentPort = {
    async hasRulePermission() { return true; },
    async hasNetworkPermission() { calls.push('permission'); return network; },
    async addRule(tabId) { calls.push(`add:${tabId}`); rules.add(tabId); },
    async removeRule(tabId) { calls.push(`remove:${tabId}`); if (failRemove) throw new Error('remove failed'); rules.delete(tabId); },
    async listRuleTabs() { return [...rules]; },
    async isTabOpen() { return false; },
    async navigateToBlock(tabId) { calls.push(`navigate:${tabId}`); if (failNavigate) throw new Error('navigation failed'); },
    async close(tabId) { calls.push(`close:${tabId}`); },
    async returnToPage(tabId) {
      calls.push(`return:${tabId}`);
      expect(rules.has(tabId)).toBe(false);
      expect(store.quarantines.has(tabId)).toBe(false);
      expect(writes.at(-1)?.quarantines[tabId]).toBeUndefined();
      return { navigation: 'requested' };
    },
  };
  return {
    calls, rules, writes, store, port, containment: new Containment(store, port),
    setFailWrite(value: boolean) { failWrite = value; },
    setFailNavigate(value: boolean) { failNavigate = value; },
    setFailRemove(value: boolean) { failRemove = value; },
  };
}

describe('Containment', () => {
  it('checks document freshness before and after persistence, rolling back stale work', async () => {
    const first = setup();
    await expect(first.containment.quarantine(1, 'example.com', 'policy', async () => false)).rejects.toThrow(/changed/);
    expect(first.rules.size).toBe(0);
    expect(first.calls).not.toContain('navigate:1');

    const second = setup();
    let checks = 0;
    await expect(second.containment.quarantine(1, 'example.com', 'policy', async () => ++checks < 3))
      .rejects.toThrow(/changed/);
    expect(checks).toBe(3);
    expect(second.rules.size).toBe(0);
    expect(second.store.quarantines.size).toBe(0);
    expect(second.writes.at(-1)?.quarantines).toEqual({});
    expect(second.calls).not.toContain('navigate:1');
  });

  it('rolls back an installed rule and in-memory record after persistence failure', async () => {
    const state = setup();
    state.setFailWrite(true);
    await expect(state.containment.quarantine(1, 'example.com', 'policy')).rejects.toThrow(/persist/);
    expect(state.rules.size).toBe(0);
    expect(state.store.quarantines.size).toBe(0);
    expect(state.calls).not.toContain('navigate:1');
  });

  it('checks again after awaiting permission and before installing a rule', async () => {
    const state = setup();
    let current = true;
    vi.spyOn(state.port, 'hasNetworkPermission').mockImplementation(async () => { current = false; return true; });
    await expect(state.containment.quarantine(1, 'example.com', 'policy', async () => current)).rejects.toThrow(/changed/);
    expect(state.rules.size).toBe(0);
    expect(state.writes).toHaveLength(0);
    expect(state.calls).not.toContain('navigate:1');
  });

  it('keeps a failed rollback visible and permits an explicit release retry', async () => {
    const state = setup();
    state.setFailRemove(true);
    let checks = 0;
    await expect(state.containment.quarantine(1, 'example.com', 'policy', async () => ++checks < 3))
      .rejects.toThrow(/Cleanup may be incomplete/);
    expect(state.rules.has(1)).toBe(true);
    expect(state.store.quarantines.get(1)?.networkBlocked).toBe(true);
    expect(state.writes.at(-1)?.quarantines[1]?.networkBlocked).toBe(true);
    expect(state.calls).not.toContain('navigate:1');
    state.setFailRemove(false);
    await state.containment.release(1);
    expect(state.rules.size).toBe(0);
    expect(state.store.quarantines.size).toBe(0);
  });

  it('does not remove a pre-existing quarantine while rolling back a stale repeated request', async () => {
    const state = setup();
    const original = await state.containment.quarantine(1, 'example.com', 'original');
    let checks = 0;
    await expect(state.containment.quarantine(1, 'example.com', 'replacement', async () => ++checks < 3))
      .rejects.toThrow(/changed/);
    expect(state.rules.has(1)).toBe(true);
    expect(state.store.quarantines.get(1)).toEqual(original);
    expect(state.writes.at(-1)?.quarantines[1]).toEqual(original);
  });

  it('replaces the document when optional network rule installation fails', async () => {
    const state = setup();
    vi.spyOn(state.port, 'addRule').mockRejectedValue(new Error('rule limit'));
    expect(await state.containment.quarantine(1, 'example.com', 'policy')).toMatchObject({ networkBlocked: false });
    expect(state.calls).toContain('navigate:1');
  });

  it('rolls back a failed document replacement when no network block was installed', async () => {
    const state = setup(false);
    state.setFailNavigate(true);
    await expect(state.containment.quarantine(1, 'example.com', 'policy')).rejects.toThrow(/replace/);
    expect(state.rules.size).toBe(0);
    expect(state.store.quarantines.size).toBe(0);
    expect(state.writes.at(-1)?.quarantines).toEqual({});
  });

  it('preserves partial network containment if document replacement fails', async () => {
    const state = setup();
    state.setFailNavigate(true);
    await expect(state.containment.quarantine(1, 'example.com', 'policy')).rejects.toThrow(/network block remains/);
    expect(state.rules.has(1)).toBe(true);
    expect(state.store.quarantines.get(1)?.networkBlocked).toBe(true);
  });

  it('releases network rules, closes actual tabs, and serializes duplicate calls', async () => {
    const state = setup();
    await Promise.all([
      state.containment.quarantine(1, 'example.com', 'policy'),
      state.containment.quarantine(1, 'example.com', 'policy'),
    ]);
    expect(state.calls.filter((call) => call === 'navigate:1')).toHaveLength(2);
    await state.containment.release(1);
    expect(state.calls).not.toContain('return:1');
    expect(state.rules.size).toBe(0);
    expect(state.store.quarantines.size).toBe(0);
    await state.containment.quarantine(1, 'example.com', 'policy');
    await state.containment.close(1);
    expect(state.calls).toContain('close:1');
    expect(state.rules.size).toBe(0);
    expect(state.store.quarantines.size).toBe(0);
  });

  it('returns only after both rule cleanup and release persistence succeed, including retry from an old released page', async () => {
    const state = setup(); await state.containment.quarantine(1, 'example.com', 'policy');
    state.setFailRemove(true);
    await expect(state.containment.releaseAndReturn(1)).rejects.toThrow();
    expect(state.calls).not.toContain('return:1');
    state.setFailRemove(false); state.setFailWrite(true);
    await expect(state.containment.releaseAndReturn(1)).rejects.toThrow();
    expect(state.calls).not.toContain('return:1');
    state.setFailWrite(false);
    expect(await state.containment.releaseAndReturn(1)).toEqual({ navigation: 'requested' });
    expect(await state.containment.releaseAndReturn(1)).toEqual({ navigation: 'requested' });
  });

  it('keeps release successful but reports unavailable return when Chrome rejects back navigation', async () => {
    const state = setup(); await state.containment.quarantine(1, 'example.com', 'policy');
    vi.spyOn(state.port, 'returnToPage').mockRejectedValue(new Error('No history PRIVATE_URL'));
    expect(await state.containment.releaseAndReturn(1)).toEqual({ navigation: 'unavailable' });
    expect(state.store.quarantines.size).toBe(0); expect(state.rules.size).toBe(0);
  });

  it('reports a closed tab despite failed rule cleanup and reconciles orphan rules', async () => {
    const state = setup();
    await state.containment.quarantine(1, 'example.com', 'policy');
    state.setFailRemove(true);
    await expect(state.containment.close(1)).rejects.toThrow(/Tab was closed/);
    expect(state.calls).toContain('close:1');
    expect(state.store.quarantines.size).toBe(0);
    state.setFailRemove(false);
    await state.containment.reconcile(new Set());
    expect(state.rules.size).toBe(0);
  });

  it('retains quarantine on failed rule removal, then records partial release if persistence fails', async () => {
    const state = setup();
    await state.containment.quarantine(1, 'example.com', 'policy');
    state.setFailRemove(true);
    await expect(state.containment.release(1)).rejects.toThrow(/remove/);
    expect(state.store.quarantines.get(1)?.networkBlocked).toBe(true);
    state.setFailRemove(false);
    state.setFailWrite(true);
    await expect(state.containment.release(1)).rejects.toThrow(/rule was removed/);
    expect(state.rules.size).toBe(0);
    expect(state.store.quarantines.get(1)?.networkBlocked).toBe(false);
    state.setFailWrite(false);
    await state.containment.release(1);
    expect(state.store.quarantines.size).toBe(0);
  });

  it('reports successful closure when only subsequent persistence failed', async () => {
    const state = setup();
    await state.containment.quarantine(1, 'example.com', 'policy');
    state.setFailWrite(true);
    await expect(state.containment.close(1)).rejects.toThrow(/Tab was closed.*persisted/);
    expect(state.calls).toContain('close:1');
    expect(state.rules.size).toBe(0);
    expect(state.store.quarantines.size).toBe(0);
  });

  it('preserves containment when Chrome refuses to close a tab', async () => {
    const state = setup();
    await state.containment.quarantine(1, 'example.com', 'policy');
    vi.spyOn(state.port, 'close').mockRejectedValue(new Error('close rejected'));
    await expect(state.containment.close(1)).rejects.toThrow(/close rejected/);
    expect(state.rules.has(1)).toBe(true);
    expect(state.store.quarantines.has(1)).toBe(true);
  });

  it('restores live quarantine rules and removes rules with no record', async () => {
    const state = setup();
    const record: QuarantineRecord = { tabId: 1, domain: 'example.com', reason: 'policy', createdAt: 100,
      networkBlocked: false };
    state.store.quarantines.set(1, record);
    state.rules.add(2);
    await state.containment.reconcile(new Set([1, 2]));
    expect(state.rules.has(1)).toBe(true);
    expect(state.rules.has(2)).toBe(false);
    expect(record.networkBlocked).toBe(true);
  });

  it('rechecks a live quarantine created after the tab snapshot before destructive cleanup', async () => {
    const state = setup();
    await state.containment.quarantine(1, 'example.com', 'policy');
    vi.spyOn(state.port, 'isTabOpen').mockResolvedValue(true);
    await state.containment.reconcile(new Set());
    expect(state.rules.has(1)).toBe(true);
    expect(state.store.quarantines.has(1)).toBe(true);
    expect(state.calls).not.toContain('remove:1');
  });

  it('removes session rules after host access is revoked, preserving document quarantine', async () => {
    const state = setup();
    await state.containment.quarantine(1, 'example.com', 'policy');
    vi.spyOn(state.port, 'hasNetworkPermission').mockResolvedValue(false);
    state.rules.add(2);
    await state.containment.reconcile(new Set([1, 2]));
    expect(state.rules.size).toBe(0);
    expect(state.store.quarantines.get(1)?.networkBlocked).toBe(false);
    await state.containment.release(1);
    expect(state.store.quarantines.size).toBe(0);
  });

  it('continues reconciliation after one orphan rule cannot be removed', async () => {
    const state = setup();
    state.rules.add(1);
    state.rules.add(2);
    const remove = state.port.removeRule;
    vi.spyOn(state.port, 'removeRule').mockImplementation(async (tabId) => {
      if (tabId === 1) throw new Error('failed');
      return remove(tabId);
    });
    await expect(state.containment.reconcile(new Set())).rejects.toThrow(/reconciled/);
    expect([...state.rules]).toEqual([1]);
  });
});

describe('Chrome containment adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requires DNR permission and persistent HTTP(S) host access', async () => {
    const getAll = vi.fn();
    vi.stubGlobal('chrome', { permissions: { getAll } });
    const port = chromeContainmentPort();
    getAll.mockResolvedValue({ permissions: ['declarativeNetRequestWithHostAccess'], origins: [] });
    expect(await port.hasNetworkPermission()).toBe(false);
    expect(await port.hasRulePermission()).toBe(true);
    getAll.mockResolvedValue({ permissions: [], origins: ['https://example.com/*'] });
    expect(await port.hasNetworkPermission()).toBe(false);
    expect(await port.hasRulePermission()).toBe(false);
    getAll.mockResolvedValue({ permissions: ['declarativeNetRequestWithHostAccess'], origins: ['https://example.com/*'] });
    expect(await port.hasNetworkPermission()).toBe(true);
  });

  it('explicitly includes main-frame navigation in tab-scoped HTTP(S) blocking', async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { declarativeNetRequest: { getSessionRules: async () => [], updateSessionRules, RuleActionType: { BLOCK: 'block' } } });
    await chromeContainmentPort().addRule(7);
    expect(updateSessionRules).toHaveBeenCalledWith({ removeRuleIds: [], addRules: [{ id: 1_000_000, priority: 1,
      action: { type: 'block' }, condition: { tabIds: [7], regexFilter: '^(?:https?|wss?)://', resourceTypes: expect.arrayContaining(['main_frame', 'sub_frame', 'xmlhttprequest', 'websocket']) } }] });
    const filter = updateSessionRules.mock.calls[0]![0].addRules![0]!.condition.regexFilter!;
    for (const url of ['https://example.com/', 'http://example.com/', 'ws://example.com/', 'wss://example.com/']) expect(new RegExp(filter).test(url)).toBe(true);
  });

  it('allocates distinct rule IDs concurrently for the full Chrome tab-ID range', async () => {
    let rules: chrome.declarativeNetRequest.Rule[] = [];
    vi.stubGlobal('chrome', { declarativeNetRequest: {
      RuleActionType: { BLOCK: 'block' },
      getSessionRules: async () => structuredClone(rules),
      updateSessionRules: async (update: chrome.declarativeNetRequest.UpdateRuleOptions) => {
        rules = rules.filter((rule) => !update.removeRuleIds?.includes(rule.id)).concat(update.addRules ?? []);
      },
    } });
    const port = chromeContainmentPort();
    await Promise.all([port.addRule(2_147_483_647), port.addRule(0), port.addRule(7)]);
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(3);
    expect(await port.listRuleTabs()).toEqual([2_147_483_647, 0, 7]);
    await port.addRule(2_147_483_647);
    expect(rules).toHaveLength(3);
    await port.removeRule(2_147_483_647);
    expect(await port.listRuleTabs()).toEqual([0, 7]);
  });

  it('only lists session rules in AgentGuard’s own rule shape', async () => {
    vi.stubGlobal('chrome', { declarativeNetRequest: {
      RuleActionType: { BLOCK: 'block' },
      async getSessionRules() { return [
        { id: 2, action: { type: 'block' }, condition: { regexFilter: '^https?://', tabIds: [1] } },
        { id: 900, action: { type: 'block' }, condition: { regexFilter: '^https?://', tabIds: [2] } },
        { id: 4, action: { type: 'allow' }, condition: { regexFilter: '^https?://', tabIds: [3] } },
      ]; },
    } });
    expect(await chromeContainmentPort().listRuleTabs()).toEqual([1]);
  });
});
