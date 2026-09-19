import type { QuarantineRecord } from '../shared/contracts';

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
