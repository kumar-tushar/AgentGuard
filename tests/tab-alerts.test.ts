import { describe, expect, it, vi } from 'vitest';
import { ALERT_MUTE_MS, MAX_ALERT_TABS, TabAlerts, parseAlertActivation, parseAlertMutes, type AlertMuteData } from '../src/background/tab-alerts';
import type { TabAlertStack } from '../src/content/tab-alert';
import type { TabAgentStatus } from '../src/shared/contracts';

const NOW = 1_000_000;
function status(tabId = 1, state: TabAgentStatus['status'] = 'AUTOMATION_LIKELY', now = NOW): TabAgentStatus {
  return { tabId, domain: 'example.com', status: state, confidence: 0.82, identifiedAgent: null, frameworkHints: [],
    evidence: [], coverage: [], firstDetectedAt: now, lastDetectedAt: now, assessedAt: now, expiresAt: now + 90_000,
    policy: { action: 'none', reason: 'No policy', matchedDomain: null } };
}
function fixture(initial: unknown = undefined) {
  let stored: unknown = initial;
  let now = NOW;
  let sequence = 0;
  const tabs = new Map<number, TabAgentStatus>([[1, status()]]);
  const port = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (data: AlertMuteData) => { stored = data; }),
    assessments: () => [...tabs.values()],
    recipients: vi.fn(async () => [1]),
    document: vi.fn(async (id: number): Promise<string | null> => `document-${id}`),
    present: vi.fn(async (_id: number, _doc: string, _input: TabAlertStack | null) => undefined),
    activate: vi.fn(async (_id: number) => undefined),
  };
  const create = () => new TabAlerts(port, () => now, () => `token-${++sequence}`);
  const stack = (hostId = 1) => port.present.mock.calls.filter(([id]) => id === hostId).at(-1)![2]!;
  const token = (sourceId = 1, hostId = 1) => stack(hostId).alerts.find(card => card.tabId === sourceId)!.token;
  return { port, tabs, create, alerts: create(), stack, token, setNow(value: number) { now = value; }, stored: () => stored };
}

describe('tab alert message and storage boundaries', () => {
  it('accepts only the exact activation packet, never a caller-selected tab', () => {
    const input = { type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: 'token-1' };
    expect(parseAlertActivation(input)).toBe('token-1');
    for (const invalid of [null, [], {}, { ...input, tabId: 2 }, { ...input, schemaVersion: 2 }, { ...input, token: '' },
      { ...input, token: 'x'.repeat(129) }, { ...input, token: 'https://example.com' }, { ...input, type: 'DISMISS_TAB_ALERT' }]) {
      expect(parseAlertActivation(invalid)).toBeNull();
    }
  });
  it('restores only live, unexpired deadlines with bounded storage', () => {
    expect([...parseAlertMutes({ schemaVersion: 1, entries: [
      { tabId: 1, mutedUntil: NOW + ALERT_MUTE_MS }, { tabId: 2, mutedUntil: NOW }, { tabId: 3, mutedUntil: NOW + 1 },
    ] }, new Set([1, 2]), NOW)]).toEqual([[1, NOW + ALERT_MUTE_MS]]);
  });
  it('rejects malformed, duplicate, oversized, or excessive deadlines', () => {
    const entry = { tabId: 1, mutedUntil: NOW + 1 };
    const invalid = [undefined, null, [], {}, { schemaVersion: 2, entries: [] }, { schemaVersion: 1, entries: [], extra: 1 },
      ...[[{ ...entry, tabId: -1 }], [{ ...entry, tabId: 2 ** 31 }], [{ ...entry, mutedUntil: NOW + ALERT_MUTE_MS + 1 }],
        [{ ...entry, mutedUntil: 1.5 }], [{ ...entry, url: 'https://example.com' }], [entry, entry],
        Array.from({ length: MAX_ALERT_TABS + 1 }, (_, tabId) => ({ ...entry, tabId })),
      ].map(entries => ({ schemaVersion: 1, entries }))];
    for (const value of invalid) expect(parseAlertMutes(value, new Set([1]), NOW).size).toBe(0);
  });
});

describe('TabAlerts', () => {
  it('presents document-bound qualified cards without page content or identity', async () => {
    const f = fixture();
    await f.alerts.load(new Set([1]));
    await f.alerts.refresh();
    expect(f.port.present).toHaveBeenCalledWith(1, 'document-1', { revision: NOW * 1000, alerts: [{
      tabId: 1, domain: 'example.com', state: 'AUTOMATION_LIKELY', confidence: 0.82, assessedAt: NOW, expiresAt: NOW + 90_000, token: 'token-1',
    }] });
    expect(f.port.write).not.toHaveBeenCalled();
  });
  it.each(['NO_AUTOMATION_OBSERVED', 'UNMONITORED'] as const)('removes %s sources and revokes their tokens', async state => {
    const f = fixture();
    await f.alerts.refresh();
    const token = f.token();
    f.tabs.set(1, status(1, state));
    await f.alerts.refresh();
    expect(f.stack().alerts).toEqual([]);
    expect(await f.alerts.activate(1, 'document-1', token)).toBeNull();
    expect(f.port.activate).not.toHaveBeenCalled();
  });
  it('keeps one token through same-document refreshes but rotates on navigation', async () => {
    const f = fixture();
    await f.alerts.refresh();
    const prior = f.token();
    const revision = f.stack().revision;
    f.tabs.set(1, status());
    await f.alerts.refresh();
    expect(f.token()).toBe(prior);
    expect(f.stack().revision).toBeGreaterThan(revision);
    f.port.document.mockResolvedValue('new-document');
    await f.alerts.refresh();
    expect(f.token()).not.toBe(prior);
    expect(await f.alerts.activate(1, 'document-1', prior)).toBeNull();
    expect(await f.alerts.activate(1, 'new-document', prior)).toBeNull();
  });
  it('drops invalidated sources during lookup and skips inaccessible hosts', async () => {
    const f = fixture();
    f.port.document.mockImplementationOnce(async () => { f.tabs.clear(); return 'document-1'; });
    await f.alerts.refresh();
    expect(f.stack().alerts).toEqual([]);
    f.port.present.mockClear();
    f.port.document.mockResolvedValue(null);
    await f.alerts.refresh();
    expect(f.port.present).not.toHaveBeenCalled();
  });
  it('rejects wrong-host, wrong-document, forged and expired tokens', async () => {
    const f = fixture();
    await f.alerts.refresh();
    const token = f.token();
    for (const [id, doc, value] of [[2, 'document-1', token], [1, 'document-2', token], [1, 'document-1', 'forged']] as const) {
      expect(await f.alerts.activate(id, doc, value)).toBeNull();
    }
    f.port.document.mockResolvedValueOnce('navigated');
    expect(await f.alerts.activate(1, 'document-1', token)).toBeNull();
    f.setNow(NOW + 90_000);
    expect(await f.alerts.activate(1, 'document-1', token)).toBeNull();
    expect(f.port.write).not.toHaveBeenCalled();
    expect(f.port.activate).not.toHaveBeenCalled();
    await f.alerts.refresh();
    expect(f.stack().alerts).toEqual([]);
  });
  it('activates only the issued source and mutes it across hosts, keeping other cards', async () => {
    const f = fixture();
    f.tabs.set(2, status(2)); f.tabs.set(3, status(3));
    f.port.recipients.mockResolvedValue([1, 3]);
    await f.alerts.refresh();
    expect(f.stack().alerts.map(card => card.tabId)).toEqual([1, 2, 3]);
    const token2 = f.token(2, 3), replay = f.token(2, 1);
    expect(await f.alerts.activate(3, 'document-3', token2)).toBe(NOW + ALERT_MUTE_MS);
    expect(f.port.activate).toHaveBeenCalledExactlyOnceWith(2);
    expect(f.stored()).toEqual({ schemaVersion: 1, entries: [{ tabId: 2, mutedUntil: NOW + ALERT_MUTE_MS }] });
    expect(await f.alerts.activate(1, 'document-1', replay)).toBeNull();
    await f.alerts.refresh();
    expect(f.stack(1).alerts.map(card => card.tabId)).toEqual([1, 3]);
    expect(f.stack(3).alerts.map(card => card.tabId)).toEqual([1, 3]);
  });
  it('persists exact 24-hour source mutes across navigation and worker reconstruction', async () => {
    const f = fixture();
    await f.alerts.refresh();
    expect(await f.alerts.activate(1, 'document-1', f.token())).toBe(NOW + ALERT_MUTE_MS);
    f.port.document.mockImplementation(async id => `navigated-${id}`);
    const restarted = f.create();
    await restarted.load(new Set([1, 2]));
    await restarted.refresh();
    expect(f.stack().alerts).toEqual([]);
    f.tabs.set(2, status(2));
    await restarted.refresh();
    expect(f.stack().alerts.map(card => card.tabId)).toEqual([2]);
    f.setNow(NOW + ALERT_MUTE_MS);
    f.tabs.set(1, status(1, 'AUTOMATION_LIKELY', NOW + ALERT_MUTE_MS));
    await restarted.refresh();
    expect(f.stack().alerts.map(card => card.tabId)).toEqual([1]);
  });
  it('rechecks expiry and invalidation after asynchronous document lookup', async () => {
    for (const invalidate of [false, true]) {
      const f = fixture();
      await f.alerts.refresh();
      let resolveDocument!: (document: string) => void;
      f.port.document.mockImplementationOnce(() => new Promise(resolve => { resolveDocument = resolve; }));
      const activation = f.alerts.activate(1, 'document-1', f.token());
      await Promise.resolve();
      if (invalidate) f.alerts.invalidate(1); else f.setNow(NOW + 90_000);
      resolveDocument('document-1');
      expect(await activation).toBeNull();
      expect(f.port.write).not.toHaveBeenCalled();
      expect(f.port.activate).not.toHaveBeenCalled();
    }
  });
  it('rejects a navigated source even when the host is current', async () => {
    const f = fixture();
    f.tabs.set(2, status(2));
    await f.alerts.refresh();
    f.port.document.mockImplementation(async id => id === 2 ? 'new-source-document' : 'document-1');
    expect(await f.alerts.activate(1, 'document-1', f.token(2))).toBeNull();
    expect(f.port.activate).not.toHaveBeenCalled();
  });
  it('does not mute on activation failure and permits retry', async () => {
    const f = fixture();
    await f.alerts.refresh();
    const token = f.token();
    f.port.activate.mockRejectedValueOnce(new Error('tab unavailable'));
    await expect(f.alerts.activate(1, 'document-1', token)).rejects.toThrow('tab unavailable');
    expect(f.port.write).not.toHaveBeenCalled();
    expect(await f.alerts.activate(1, 'document-1', token)).toBe(NOW + ALERT_MUTE_MS);
  });
  it('does not acknowledge failed persistence after focusing and permits retry', async () => {
    const f = fixture();
    await f.alerts.refresh();
    const token = f.token();
    f.port.write.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(f.alerts.activate(1, 'document-1', token)).rejects.toThrow('storage unavailable');
    expect(f.port.activate).toHaveBeenCalledWith(1);
    expect(f.stored()).toBeUndefined();
    await f.alerts.refresh();
    expect(f.token()).toBe(token);
    expect(await f.alerts.activate(1, 'document-1', token)).toBe(NOW + ALERT_MUTE_MS);
  });
  it('serializes activations so simultaneous sources retain both preferences', async () => {
    const f = fixture();
    f.tabs.set(2, status(2));
    await f.alerts.refresh();
    await Promise.all([f.alerts.activate(1, 'document-1', f.token(1)), f.alerts.activate(1, 'document-1', f.token(2))]);
    expect(f.stored()).toEqual({ schemaVersion: 1, entries: [1, 2].map(tabId => ({ tabId, mutedUntil: NOW + ALERT_MUTE_MS })) });
  });
  it('forgets closed/replaced tabs without muting a reused tab id', async () => {
    const f = fixture();
    await f.alerts.refresh();
    await f.alerts.activate(1, 'document-1', f.token());
    await f.alerts.forget(1);
    expect(f.stored()).toEqual({ schemaVersion: 1, entries: [] });
    await f.alerts.refresh();
    expect(f.stack().alerts).toHaveLength(1);
  });
  it('removes closed sources from other hosts and clears inactive hosts', async () => {
    const f = fixture();
    f.tabs.set(2, status(2));
    await f.alerts.refresh();
    const old = f.token();
    f.tabs.delete(1);
    await f.alerts.forget(1);
    f.port.recipients.mockResolvedValue([2]);
    await f.alerts.refresh();
    expect(f.stack(2).alerts.map(card => card.tabId)).toEqual([2]);
    expect(await f.alerts.activate(1, 'document-1', old)).toBeNull();
    f.port.recipients.mockResolvedValue([]);
    await f.alerts.refresh();
    expect(f.port.present).toHaveBeenLastCalledWith(2, 'document-2', { revision: expect.any(Number), alerts: [] });
  });
  it('continues delivery to another window when one host rejects injection', async () => {
    const f = fixture();
    f.port.recipients.mockResolvedValue([1, 2]);
    f.port.present.mockRejectedValueOnce(new Error('site denied'));
    await expect(f.alerts.refresh()).rejects.toThrow('unavailable');
    expect(f.stack(2).alerts.map(card => card.tabId)).toEqual([1]);
    expect(await f.alerts.activate(1, 'document-1', 'token-1')).toBeNull();
    expect(await f.alerts.activate(2, 'document-2', f.token(1, 2))).toBe(NOW + ALERT_MUTE_MS);
  });
  it('bounds mute capacity without falsely acknowledging dismissal', async () => {
    const f = fixture({ schemaVersion: 1, entries: Array.from({ length: MAX_ALERT_TABS }, (_, tabId) => ({ tabId, mutedUntil: NOW + 1 })) });
    await f.alerts.load(new Set(Array.from({ length: MAX_ALERT_TABS }, (_, id) => id)));
    f.tabs.set(MAX_ALERT_TABS, status(MAX_ALERT_TABS));
    await f.alerts.refresh();
    const token = f.token(MAX_ALERT_TABS);
    await expect(f.alerts.activate(1, 'document-1', token)).rejects.toThrow('capacity');
    f.setNow(NOW + 1);
    expect(await f.alerts.activate(1, 'document-1', token)).toBe(NOW + 1 + ALERT_MUTE_MS);
  });
});
