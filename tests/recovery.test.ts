import { describe, expect, it, vi } from 'vitest';
import { restoreQuarantinedTab, type RecoveryPort } from '../src/background/recovery';

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
