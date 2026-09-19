import type { QuarantineRecord } from '../shared/contracts';
import { MAX_SESSION_TABS, type SessionStore } from './session';

export interface ContainmentPort {
  hasRulePermission(): Promise<boolean>;
  hasNetworkPermission(): Promise<boolean>;
  addRule(tabId: number): Promise<void>;
  removeRule(tabId: number): Promise<void>;
  listRuleTabs(): Promise<number[]>;
  isTabOpen(tabId: number): Promise<boolean>;
  navigateToBlock(tabId: number): Promise<void>;
  close(tabId: number): Promise<void>;
}

export class Containment {
  private locks = new Map<number, Promise<unknown>>();
  constructor(private readonly store: SessionStore, private readonly port: ContainmentPort) {}

  private serialize<T>(tabId: number, action: () => Promise<T>): Promise<T> {
    const pending = (this.locks.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(action);
    this.locks.set(tabId, pending);
    void pending.finally(() => { if (this.locks.get(tabId) === pending) this.locks.delete(tabId); }).catch(() => undefined);
    return pending;
  }

  quarantine(tabId: number, domain: string | null, reason: string,
    precondition?: () => Promise<boolean>): Promise<QuarantineRecord> {
    return this.serialize(tabId, async () => {
      const isCurrent = async () => {
        try { return !precondition || await precondition(); }
        catch { return false; }
      };
      if (!await isCurrent()) throw new Error('The assessed tab document changed before quarantine.');
      const previous = this.store.quarantines.get(tabId);
      if (!previous && this.store.quarantines.size >= MAX_SESSION_TABS) throw new Error('The quarantine limit has been reached. Release or close a quarantined tab first.');
      let networkBlocked = false;
      let installedRule = false;
      const networkEnabled = await this.port.hasNetworkPermission();
      // Permission checks can yield across a navigation. Recheck before installing a tab-wide rule.
      if (!await isCurrent()) throw new Error('The assessed tab document changed before quarantine.');
      if (networkEnabled) {
        // If optional blocking fails, page replacement still provides useful containment.
        try { await this.port.addRule(tabId); installedRule = true; networkBlocked = true; }
        catch { networkBlocked = false; }
      }
      const record = { tabId, domain, createdAt: Date.now(), reason, networkBlocked };
      this.store.quarantines.set(tabId, record);
      const rollback = async (message: string): Promise<never> => {
        let incomplete = false;
        let ruleRemains = false;
        if (installedRule && !previous?.networkBlocked) {
          try { await this.port.removeRule(tabId); } catch { incomplete = true; ruleRemains = true; }
        }
        // Keep failed cleanup visible and retryable instead of forgetting an installed rule.
        if (ruleRemains) this.store.quarantines.set(tabId, record);
        else if (previous) this.store.quarantines.set(tabId, previous);
        else this.store.quarantines.delete(tabId);
        try { await this.store.persist(); } catch { incomplete = true; }
        throw new Error(incomplete ? `${message} Cleanup may be incomplete.` : message);
      };
      try { await this.store.persist(); }
      catch { return rollback('Could not persist quarantine state.'); }
      if (!await isCurrent()) return rollback('The assessed tab document changed before quarantine.');
      try {
        await this.port.navigateToBlock(tabId);
      } catch {
        // Preserve a successful network block, and report the failed page replacement.
        if (!networkBlocked) return rollback('Could not replace the tab document.');
        throw new Error('Could not replace the tab document. Any installed network block remains active.');
      }
      return record;
    });
  }

  release(tabId: number): Promise<void> {
    return this.serialize(tabId, async () => {
      const previous = this.store.quarantines.get(tabId);
      if (await this.port.hasRulePermission()) await this.port.removeRule(tabId);
      this.store.quarantines.delete(tabId);
      try { await this.store.persist(); }
      catch {
        if (previous) this.store.quarantines.set(tabId, { ...previous, networkBlocked: false });
        throw new Error('Network rule was removed, but release state could not be persisted.');
      }
    });
  }

  close(tabId: number): Promise<void> {
    return this.serialize(tabId, async () => {
      await this.port.close(tabId);
      let cleanupFailed = false;
      try {
        if (await this.port.hasRulePermission()) {
          await this.port.removeRule(tabId);
        }
      } catch { cleanupFailed = true; }
      this.store.quarantines.delete(tabId);
      this.store.tabs.delete(tabId);
      try { await this.store.persist(); }
      catch { throw new Error('Tab was closed, but cleanup state could not be persisted. Temporary rules may remain until reconciliation.'); }
      if (cleanupFailed) throw new Error('Tab was closed, but its temporary network rule may remain until reconciliation.');
    });
  }

  async reconcile(liveTabIds: ReadonlySet<number>): Promise<void> {
    const networkEnabled = await this.port.hasNetworkPermission();
    let incomplete = false;
    // Rules still need cleanup when the last host grant was revoked but the DNR API remains available.
    if (await this.port.hasRulePermission()) {
      for (const tabId of new Set(await this.port.listRuleTabs())) {
        try {
          await this.serialize(tabId, async () => {
            if (!networkEnabled || !this.store.quarantines.has(tabId) ||
                (!liveTabIds.has(tabId) && !await this.port.isTabOpen(tabId))) await this.port.removeRule(tabId);
          });
        } catch { incomplete = true; }
      }
    }
    for (const tabId of [...this.store.quarantines.keys()]) {
      try {
        await this.serialize(tabId, async () => {
          const record = this.store.quarantines.get(tabId);
          if (!record) return;
          // A quarantine can be created after the caller collected the tab snapshot.
          if (!liveTabIds.has(tabId) && !await this.port.isTabOpen(tabId)) this.store.quarantines.delete(tabId);
          else if (networkEnabled) {
            try { await this.port.addRule(tabId); record.networkBlocked = true; }
            catch { record.networkBlocked = false; incomplete = true; }
          } else record.networkBlocked = false;
          await this.store.persist();
        });
      } catch { incomplete = true; }
    }
    if (incomplete) throw new Error('Some quarantine rules or records could not be reconciled.');
  }
}

export function chromeContainmentPort(): ContainmentPort {
  // Chrome tab IDs span the signed 32-bit range. Allocate rule IDs separately
  // rather than overflowing at tabId + 1, and serialize allocation across tabs.
  const firstRuleId = 1_000_000;
  const lastRuleId = firstRuleId + MAX_SESSION_TABS * 2 - 1;
  let ruleQueue: Promise<void> = Promise.resolve();
  const changeRules = (operation: () => Promise<void>) => {
    const result = ruleQueue.then(operation);
    ruleQueue = result.catch(() => undefined);
    return result;
  };
  const ownsRule = (rule: chrome.declarativeNetRequest.Rule) => {
    const tabId = rule.condition.tabIds?.[0];
    return tabId !== undefined && rule.condition.tabIds?.length === 1 &&
      rule.action.type === chrome.declarativeNetRequest.RuleActionType.BLOCK && rule.condition.regexFilter === '^https?://' &&
      ((rule.id >= firstRuleId && rule.id <= lastRuleId) || rule.id === tabId + 1);
  };
  return {
    async hasRulePermission() {
      return (await chrome.permissions.getAll()).permissions?.includes('declarativeNetRequestWithHostAccess') ?? false;
    },
    async hasNetworkPermission() {
      const granted = await chrome.permissions.getAll();
      return Boolean(granted.permissions?.includes('declarativeNetRequestWithHostAccess') &&
        granted.origins?.some((origin) => /^https?:\/\//u.test(origin)));
    },
    addRule: (tabId) => changeRules(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const previous = rules.filter((rule) => ownsRule(rule) && rule.condition.tabIds?.[0] === tabId);
      const occupied = new Set(rules.map((rule) => rule.id));
      let id = previous.find((rule) => rule.id >= firstRuleId && rule.id <= lastRuleId)?.id ?? firstRuleId;
      if (!previous.some((rule) => rule.id === id)) while (occupied.has(id) && id <= lastRuleId) id++;
      if (id > lastRuleId) throw new Error('No quarantine rule slots remain.');
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: previous.map((rule) => rule.id),
        addRules: [{
          id, priority: 1,
          action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
          // Chrome defaults to excluding main_frame, including with an empty exclusion list.
          condition: { tabIds: [tabId], regexFilter: '^https?://', resourceTypes: [
            'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
            'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other',
          ] },
        }],
      });
    }),
    removeRule: (tabId) => changeRules(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: rules.filter((rule) => ownsRule(rule) && rule.condition.tabIds?.[0] === tabId).map((rule) => rule.id),
      });
    }),
    async listRuleTabs() {
      return (await chrome.declarativeNetRequest.getSessionRules()).flatMap((rule) => ownsRule(rule) ? rule.condition.tabIds! : []);
    },
    async isTabOpen(tabId) {
      // query() returns IDs without requiring the broad tabs permission.
      return (await chrome.tabs.query({})).some((tab) => tab.id === tabId);
    },
    async navigateToBlock(tabId) { await chrome.tabs.update(tabId, { url: chrome.runtime.getURL('blocked.html') }); },
    close: (tabId) => chrome.tabs.remove(tabId),
  };
}
