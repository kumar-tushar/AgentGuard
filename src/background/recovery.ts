import type { QuarantineRecord, ReleaseResult } from '../shared/contracts';

export interface RecoveryPort {
  getUrl(tabId: number): Promise<string | undefined>;
  isContainmentPage(url?: string): boolean;
  hasRecord(tabId: number): boolean;
  replace(record: QuarantineRecord, isCurrent: () => Promise<boolean>): Promise<void>;
}

/** A stored quarantine request is not proof that its replacement document remains loaded. */
export async function restoreQuarantinedTab(record: QuarantineRecord, port: RecoveryPort): Promise<boolean> {
  const url = await port.getUrl(record.tabId);
  if (port.isContainmentPage(url) || !port.hasRecord(record.tabId)) return false;
  await port.replace(record, async () => port.hasRecord(record.tabId) && (await port.getUrl(record.tabId)) === url);
  return true;
}

export interface PageReturnPort {
  getTab(tabId: number): Promise<{ url?: string; status?: string }>;
  isContainmentPage(url?: string): boolean;
  goBack(tabId: number): Promise<void>;
}

/** Chrome owns the previous URL/history. Never read or persist it in AgentGuard. */
export async function returnToPreviousPage(tabId: number, port: PageReturnPort): Promise<ReleaseResult> {
  try {
    const tab = await port.getTab(tabId);
    if (!tab.url) return { navigation: 'unavailable' };
    if (!port.isContainmentPage(tab.url)) return { navigation: 'not_needed' };
    // Do not issue a second Back during an already pending tab navigation.
    if (tab.status === 'loading') return { navigation: 'unavailable' };
    await port.goBack(tabId);
    return { navigation: 'requested' };
  } catch {
    // Missing history/closed tab/Chrome errors must not leak a URL or claim return.
    return { navigation: 'unavailable' };
  }
}
