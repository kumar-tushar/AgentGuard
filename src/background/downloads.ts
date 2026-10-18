import type { DownloadPolicy, DownloadRecord } from '../shared/traffic';
import { domainFromUrl } from '../shared/domains';

/** Chrome DownloadItem has no tab ID. Never infer it from active/sole agent tabs or URLs. */
export class DownloadMonitor {
  private records: DownloadRecord[] = [];
  constructor(private readonly port: { policy(): DownloadPolicy; permitted(): Promise<boolean>; cancel(id: number): Promise<void> }, private readonly now = Date.now) {}
  async created(item: Pick<chrome.downloads.DownloadItem, 'id' | 'url'>): Promise<void> {
    const policy = this.port.policy();
    if (policy === 'off' || !Number.isSafeInteger(item.id) || item.id < 0 || !await this.port.permitted()) return;
    let action: DownloadRecord['action'] = 'observed';
    if (policy === 'block_all') {
      // Explicit browser-wide policy only; no heuristic attribution or guessed tab.
      try { await this.port.cancel(item.id); action = 'cancel_confirmed'; }
      catch { action = 'cancel_failed'; }
    }
    this.records.push({ id: item.id, timestamp: this.now(), domain: domainFromUrl(item.url), tabId: null, initiator: 'unknown', action });
    this.records = this.records.slice(-200);
  }
  clear(): void { this.records = []; }
  snapshot(): DownloadRecord[] { return structuredClone(this.records); }
}
