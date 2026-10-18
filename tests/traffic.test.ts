import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrafficObserver } from '../src/background/traffic';
import { observationOwners } from '../src/background/debugger-ownership';
import { DownloadMonitor } from '../src/background/downloads';
import { DesktopAlerts } from '../src/background/notifications';
import { unknownStatus } from '../src/background/monitor';

afterEach(() => observationOwners.clear());
const port = () => ({ attach: vi.fn(async (_id: number) => undefined), command: vi.fn(async (_id: number, _method: string) => undefined), detach: vi.fn(async (_id: number) => undefined) });
describe('explicit traffic observation', () => {
  it('keeps only fixed metadata, caps storage, expires and never attributes a controller', async () => {
    let now = 1000; const api = port(); const observer = new TrafficObserver(api, () => now);
    observer.event(1, 'Network.requestWillBeSent', { request: { url: 'https://ignored.example' } });
    expect(observer.snapshot().records).toEqual([]);
    await observer.start(1); expect(observationOwners.has(1)).toBe(true);
    for (let index = 0; index < 510; index++) observer.event(1, 'Network.requestWillBeSent', { request: { url: 'https://example.com/PRIVATE?token=SECRET', method: 'POST', headers: { Authorization: 'SECRET' }, postData: 'PASSWORD' } });
    expect(observer.snapshot().records).toHaveLength(500);
    expect(observer.snapshot().records[0]).toMatchObject({ domain: 'example.com', method: 'POST', initiator: 'unknown' });
    expect(JSON.stringify(observer.snapshot())).not.toMatch(/PRIVATE|SECRET|PASSWORD/);
    expect(api.command.mock.calls.map(call => call[1])).toEqual(['Network.enable', 'Page.enable']);
    now += 15 * 60_000; await observer.expire(); expect(observationOwners.size).toBe(0);
    expect(api.detach).toHaveBeenCalledOnce();
  });
  it('shows policy refusal as unavailable, cleans partial attachments and does not retry silently', async () => {
    const api = port(); api.attach.mockRejectedValueOnce(new Error('Host access restricted by policy'));
    const observer = new TrafficObserver(api);
    await observer.start(1); expect(observer.snapshot().leases[0]?.state).toBe('unavailable');
    expect(observationOwners.size).toBe(0); expect(api.command).not.toHaveBeenCalled();
    api.command.mockRejectedValueOnce(new Error('denied')); await observer.start(1);
    expect(api.detach).toHaveBeenCalledOnce(); expect(observationOwners.size).toBe(0);
    await observer.start(1); observer.detached(1); expect(observer.snapshot().leases[0]?.state).toBe('unavailable');
  });
  it('journals ownership before attach and restores by detaching, never by silently attaching again', async () => {
    const api = { ...port(), writeOwners: vi.fn(async (_ids: number[]) => undefined) };
    const observer = new TrafficObserver(api);
    await observer.start(1);
    expect(api.writeOwners.mock.invocationCallOrder[0]).toBeLessThan(api.attach.mock.invocationCallOrder[0]!);
    observationOwners.clear();
    const restored = new TrafficObserver(api);
    await restored.restoreOwners([1, 2], new Set([1]));
    expect(api.attach).toHaveBeenCalledOnce(); expect(api.detach).toHaveBeenCalledWith(1);
    expect(observationOwners.size).toBe(0); expect(restored.snapshot().leases).toEqual([]);
    expect(api.writeOwners).toHaveBeenLastCalledWith([]);
  });
});
describe('download policy', () => {
  it('never guesses a tab or agent and cancels only under an explicit browser-wide policy', async () => {
    let policy: 'off' | 'observe' | 'block_all' = 'off'; const cancel = vi.fn(async () => undefined);
    const monitor = new DownloadMonitor({ policy: () => policy, permitted: async () => true, cancel });
    await monitor.created({ id: 1, url: 'https://example.com/PRIVATE?token=SECRET' }); expect(monitor.snapshot()).toEqual([]);
    policy = 'observe'; await monitor.created({ id: 2, url: 'https://example.com/PRIVATE' }); expect(cancel).not.toHaveBeenCalled();
    policy = 'block_all'; await monitor.created({ id: 3, url: 'https://example.com/PRIVATE' });
    cancel.mockRejectedValueOnce(new Error('too late')); await monitor.created({ id: 4, url: 'https://example.com/PRIVATE' });
    expect(monitor.snapshot().map(item => item.action)).toEqual(['observed', 'cancel_confirmed', 'cancel_failed']);
    expect(monitor.snapshot().every(item => item.tabId === null && item.initiator === 'unknown')).toBe(true);
    expect(JSON.stringify(monitor.snapshot())).not.toContain('PRIVATE');
  });
});
describe('optional desktop alerts', () => {
  it('deduplicates and only activates a current matching source tab; never changes policy', async () => {
    let current = { ...unknownStatus(1, 'example.com', '', 1000), status: 'AUTOMATION_LIKELY' as const };
    const show = vi.fn(async (_id: string) => undefined), activate = vi.fn(async (_id: number) => undefined);
    const alerts = new DesktopAlerts({ enabled: () => true, permitted: async () => true, show, clear: async () => undefined, assessment: () => current, activate }, () => 2000);
    await alerts.consider(current); await alerts.consider(current); expect(show).toHaveBeenCalledOnce();
    const id = show.mock.calls[0]![0]!; current = { ...current, domain: 'different.example' }; await alerts.activate(id);
    expect(activate).not.toHaveBeenCalled();
  });
});
