import { describe, expect, it, vi } from 'vitest';
import { restoreQuarantinedTab, returnToPreviousPage, type RecoveryPort } from '../src/background/recovery';

describe('quarantined tab navigation recovery', () => {
  const record = { tabId: 1, domain: 'example.com', reason: 'policy', networkBlocked: false, createdAt: 1 };
  const blocked = 'chrome-extension://ours/blocked.html';
  function port(url?: string): RecoveryPort {
    return { getUrl: vi.fn(async () => url), isContainmentPage: (value) => value === blocked,
      hasRecord: () => true, replace: vi.fn(async () => undefined) };
  }
  it('replaces escaped documents even when network blocking is unavailable', async () => {
    const adapter = port('https://example.com/');
    expect(await restoreQuarantinedTab(record, adapter)).toBe(true);
    expect(adapter.replace).toHaveBeenCalledWith(record, expect.any(Function));
  });
  it('does not replace the existing containment page or a released tab', async () => {
    const adapter = port(blocked);
    expect(await restoreQuarantinedTab(record, adapter)).toBe(false);
    adapter.getUrl = async () => 'https://example.com';
    adapter.hasRecord = () => false;
    expect(await restoreQuarantinedTab(record, adapter)).toBe(false);
    expect(adapter.replace).not.toHaveBeenCalled();
  });
  it('invalidates queued recovery when the document or quarantine record changes', async () => {
    const adapter = port('https://example.com');
    adapter.replace = async (_, current) => {
      expect(await current()).toBe(true);
      adapter.getUrl = async () => 'https://other.example';
      expect(await current()).toBe(false);
      adapter.getUrl = async () => 'https://example.com';
      adapter.hasRecord = () => false;
      expect(await current()).toBe(false);
    };
    await restoreQuarantinedTab(record, adapter);
  });
});

describe('released tab return without storing its URL', () => {
  const blocked = 'chrome-extension://ours/blocked.html';
  const setup = (url: string | undefined = blocked, status = 'complete') => ({
    getTab: vi.fn(async (): Promise<{ url?: string; status?: string }> => ({ url, status })),
    isContainmentPage: (url?: string) => url === blocked,
    goBack: vi.fn(async (_tabId: number) => undefined),
  });
  it('asks Chrome to go back only from a completed containment document', async () => {
    const port = setup();
    expect(await returnToPreviousPage(7, port)).toEqual({ navigation: 'requested' });
    expect(port.goBack).toHaveBeenCalledWith(7);
    expect(port.getTab).toHaveBeenCalledWith(7);
  });
  it('does not navigate an already returned or unrelated tab', async () => {
    const port = setup('https://example.com/PRIVATE?token=SECRET');
    expect(await returnToPreviousPage(7, port)).toEqual({ navigation: 'not_needed' });
    expect(port.goBack).not.toHaveBeenCalled();
  });
  it('reports missing history, inaccessible URL or pending navigation without claiming return', async () => {
    const port = setup(); port.goBack.mockRejectedValue(new Error('Cannot go back PRIVATE_URL'));
    expect(await returnToPreviousPage(7, port)).toEqual({ navigation: 'unavailable' });
    const missing = setup(); missing.getTab.mockResolvedValue({ url: undefined, status: 'complete' });
    expect(await returnToPreviousPage(7, missing)).toEqual({ navigation: 'unavailable' });
    const loading = setup(blocked, 'loading');
    expect(await returnToPreviousPage(7, loading)).toEqual({ navigation: 'unavailable' });
    expect(loading.goBack).not.toHaveBeenCalled();
  });
});
