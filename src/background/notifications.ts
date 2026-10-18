import type { TabAgentStatus } from '../shared/contracts';
import { hasAutomation } from '../shared/intelligence';

export class DesktopAlerts {
  private notices = new Map<string, { tabId: number; domain: string; expiresAt: number }>();
  private recent = new Map<number, number>();
  constructor(private readonly port: {
    enabled(): boolean;
    permitted(): Promise<boolean>;
    show(id: string): Promise<void>;
    clear(id: string): Promise<void>;
    assessment(id: number): TabAgentStatus | undefined;
    activate(id: number): Promise<void>;
  }, private readonly now = Date.now) {}
  async consider(tab: TabAgentStatus): Promise<void> {
    if (!this.port.enabled() || !hasAutomation(tab.status) || !tab.domain || tab.expiresAt <= this.now() ||
      (this.recent.get(tab.tabId) ?? 0) > this.now() || !await this.port.permitted()) return;
    const id = `agentguard:${crypto.randomUUID()}`;
    this.recent.set(tab.tabId, this.now() + 10 * 60_000);
    if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value!);
    try {
      await this.port.show(id);
      this.notices.set(id, { tabId: tab.tabId, domain: tab.domain, expiresAt: this.now() + 10 * 60_000 });
      if (this.notices.size > 100) await this.clear(this.notices.keys().next().value!);
    } catch { this.recent.delete(tab.tabId); throw new Error('Desktop notification unavailable'); }
  }
  private async clear(id: string): Promise<void> { this.notices.delete(id); await this.port.clear(id); }
  async activate(id: string): Promise<void> {
    const notice = this.notices.get(id);
    await this.clear(id);
    if (!notice || notice.expiresAt <= this.now() || !this.port.enabled()) return;
    const tab = this.port.assessment(notice.tabId);
    if (tab?.domain === notice.domain && tab.expiresAt > this.now() && hasAutomation(tab.status)) await this.port.activate(tab.tabId);
  }
  async forget(tabId: number): Promise<void> {
    await Promise.all([...this.notices].filter(([, value]) => value.tabId === tabId).map(([id]) => this.clear(id)));
  }
}
