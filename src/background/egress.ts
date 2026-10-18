import type { ControlGrant } from '../shared/controls';

const FIRST = 2_000_000, LAST = FIRST + 999;
const TYPES: chrome.declarativeNetRequest.ResourceType[] = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'] as chrome.declarativeNetRequest.ResourceType[];
export const EGRESS_REGEX = '^(?:https?|wss?)://';

export function delegationRules(grants: readonly ControlGrant[]): chrome.declarativeNetRequest.Rule[] {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  for (const grant of grants.slice(0, 500)) {
    if (grant.blockedDomains.length) rules.push({ id: FIRST + rules.length, priority: 3, action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
      condition: { tabIds: [grant.tabId], regexFilter: EGRESS_REGEX, requestDomains: grant.blockedDomains, resourceTypes: TYPES } });
    if (grant.allowedDomains.length) rules.push({ id: FIRST + rules.length, priority: 2, action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
      condition: { tabIds: [grant.tabId], regexFilter: EGRESS_REGEX, excludedRequestDomains: grant.allowedDomains, resourceTypes: TYPES } });
  }
  return rules;
}

export class DelegationEgress {
  private queue: Promise<void> = Promise.resolve();
  private applied: chrome.declarativeNetRequest.Rule[] = [];
  reconcile(grants: readonly ControlGrant[]): Promise<void> {
    const desired = delegationRules(grants);
    const work = this.queue.then(async () => {
      const granted = await chrome.permissions.getAll();
      if (!granted.permissions?.includes('declarativeNetRequestWithHostAccess')) { this.applied = []; return; }
      const all = await chrome.declarativeNetRequest.getSessionRules();
      const owns = (rule: chrome.declarativeNetRequest.Rule) => rule.id >= FIRST && rule.id <= LAST && rule.condition.regexFilter === EGRESS_REGEX &&
        rule.action.type === 'block' && (rule.priority === 2 || rule.priority === 3) && rule.condition.tabIds?.length === 1 &&
        Boolean(rule.condition.requestDomains?.length || rule.condition.excludedRequestDomains?.length);
      const existing = all.filter(owns);
      // Old quarantine versions used tabId+1. A large tab ID may therefore
      // occupy this range; never erase or reuse that containment rule.
      const occupied = new Set(all.filter(rule => !owns(rule)).map(rule => rule.id));
      let id = FIRST;
      const next = desired.map(rule => {
        while (occupied.has(id) && id <= LAST) id++;
        if (id > LAST) throw new Error('Delegation rule capacity unavailable');
        return { ...rule, id: id++ };
      });
      if (JSON.stringify(existing) !== JSON.stringify(next)) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map(rule => rule.id), addRules: next });
      this.applied = next;
    });
    this.queue = work.catch(() => undefined); return work;
  }
  activeTabs(): number[] { return [...new Set(this.applied.flatMap(rule => rule.condition.tabIds ?? []))]; }
}
