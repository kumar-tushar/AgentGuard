export interface TabAlertPresentation {
  state: 'AGENT_ACTIVE' | 'AGENT_CONNECTED' | 'AUTOMATION_LIKELY' | 'AUTOMATION_SUSPECTED';
  confidence: number;
  assessedAt: number;
  expiresAt: number;
  token: string;
  tabId: number;
  domain: string | null;
}

export interface TabAlertStack { revision: number; alerts: TabAlertPresentation[] }

/** Serialized as a self-contained function; runs only in Chrome's ISOLATED world. */
export function renderTabAlert(input: TabAlertStack | null): void {
  const scope = globalThis as typeof globalThis & { __agentguardTabAlertV2__?: { render(value: TabAlertStack | null): void } };
  if (scope.__agentguardTabAlertV2__) { scope.__agentguardTabAlertV2__.render(input); return; }
  if (!document.documentElement) return;
  const labels: Record<TabAlertPresentation['state'], string> = {
    AGENT_ACTIVE: 'Agent activity detected', AGENT_CONNECTED: 'Agent connection detected',
    AUTOMATION_LIKELY: 'Automation likely', AUTOMATION_SUSPECTED: 'Automation suspected',
  };
  const lifetime = 90_000;
  const day = 24 * 60 * 60 * 1000;
  const limit = 500;
  type Card = { host: HTMLDivElement; heading: HTMLElement; site: HTMLElement; score: HTMLElement; value: TabAlertPresentation; pending: boolean };
  const cards = new Map<number, Card>();
  const mutes = new Map<number, number>();
  let container: HTMLDivElement | undefined;
  let revision = -1;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const remove = (tabId: number) => { cards.get(tabId)?.host.remove(); cards.delete(tabId); };
  const scheduleExpiry = () => {
    if (expiry !== undefined) clearTimeout(expiry);
    expiry = undefined;
    if (cards.size === 0) { container?.remove(); return; }
    const deadline = Math.min(...[...cards.values()].map(card => card.value.expiresAt));
    expiry = setTimeout(() => {
      for (const [tabId, card] of cards) if (card.value.expiresAt <= Date.now()) remove(tabId);
      scheduleExpiry();
    }, Math.max(0, deadline - Date.now()));
  };
  const hide = () => {
    for (const tabId of cards.keys()) remove(tabId);
    scheduleExpiry();
  };
  const createContainer = () => {
    container = document.createElement('div');
    container.setAttribute('data-agentguard-alert-stack', '');
    container.setAttribute('aria-label', 'AgentGuard tab alerts');
    container.style.cssText = 'all:initial!important;position:fixed!important;top:16px!important;right:16px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;gap:8px!important;width:300px!important;max-width:calc(100vw - 32px)!important;max-height:calc(100vh - 32px)!important;overflow-y:auto!important;isolation:isolate!important;';
  };
  const createCard = (value: TabAlertPresentation): Card => {
    const host = document.createElement('div');
    host.setAttribute('role', 'button');
    host.tabIndex = 0;
    host.style.cssText = 'all:initial!important;display:block!important;flex-shrink:0!important;width:100%!important;cursor:pointer!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host(:focus-visible){outline:3px solid #fff!important;outline-offset:-3px!important} .notice{box-sizing:border-box;padding:14px 16px;border:1px solid #fca5a5;border-radius:12px;background:#7f1d1d;color:#fff;font:13px/1.45 system-ui,sans-serif;overflow-wrap:anywhere} strong{display:block;font-size:14px} p{margin:6px 0 0}';
    const notice = document.createElement('div');
    notice.className = 'notice';
    const heading = document.createElement('strong');
    const site = document.createElement('p');
    const score = document.createElement('p');
    const identity = document.createElement('p');
    identity.textContent = 'Controller identity unverified.';
    notice.append(heading, site, score, identity);
    shadow.append(style, notice);
    const card: Card = { host, heading, site, score, value, pending: false };
    const activate = (event: Event) => {
      if (!event.isTrusted || card.pending || cards.get(card.value.tabId) !== card || card.value.expiresAt <= Date.now()) return;
      if (event.type === 'keydown' && !['Enter', ' '].includes((event as KeyboardEvent).key)) return;
      event.preventDefault();
      event.stopPropagation();
      card.pending = true;
      const selected = card.value;
      try {
        void chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB_ALERT', schemaVersion: 1, token: selected.token }).then((response: unknown) => {
          const result = response as { ok?: boolean; mutedUntil?: number } | null;
          const now = Date.now();
          if (result?.ok === true && Number.isSafeInteger(result.mutedUntil) && result.mutedUntil! > now && result.mutedUntil! <= now + day) {
            for (const [tabId, until] of mutes) if (until <= now) mutes.delete(tabId);
            if (!mutes.has(selected.tabId) && mutes.size >= limit) mutes.delete(mutes.keys().next().value!);
            mutes.set(selected.tabId, result.mutedUntil!);
            remove(selected.tabId);
            scheduleExpiry();
          }
        }, () => undefined).finally(() => { card.pending = false; });
      } catch { card.pending = false; }
    };
    host.addEventListener('click', activate);
    host.addEventListener('keydown', activate);
    return card;
  };
  const validCard = (value: TabAlertPresentation, now: number) => typeof value === 'object' && value !== null &&
    Object.keys(value).length === 7 && Object.keys(value).every(key => ['state', 'confidence', 'assessedAt', 'expiresAt', 'token', 'tabId', 'domain'].includes(key)) &&
    Object.hasOwn(labels, value.state) && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 &&
    Number.isSafeInteger(value.assessedAt) && Number.isSafeInteger(value.expiresAt) && value.assessedAt >= 0 && value.assessedAt <= now &&
    value.expiresAt > value.assessedAt && value.expiresAt - value.assessedAt <= lifetime &&
    typeof value.token === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.token) &&
    Number.isSafeInteger(value.tabId) && value.tabId >= 0 && value.tabId <= 2_147_483_647 &&
    (value.domain === null || (typeof value.domain === 'string' && value.domain.length <= 253 &&
      value.domain.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))));
  const render = (value: TabAlertStack | null) => {
    if (value === null) { hide(); return; }
    const now = Date.now();
    if (typeof value !== 'object' || Object.keys(value).length !== 2 || !Object.keys(value).every(key => ['revision', 'alerts'].includes(key)) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision <= revision || !Array.isArray(value.alerts) || value.alerts.length > limit ||
      ![...value.alerts].every(item => validCard(item, now))) return;
    revision = value.revision;
    for (const [tabId, until] of mutes) if (until <= now) mutes.delete(tabId);
    const desired = new Map<number, TabAlertPresentation>();
    for (const item of value.alerts) {
      // A duplicate cannot create another card or replace a fresher same-tab observation.
      const prior = desired.get(item.tabId) ?? cards.get(item.tabId)?.value;
      const next = prior && prior.assessedAt > item.assessedAt ? prior : item;
      if (next.expiresAt > now && (mutes.get(next.tabId) ?? 0) <= now) desired.set(next.tabId, { ...next });
    }
    for (const tabId of cards.keys()) if (!desired.has(tabId)) remove(tabId);
    if (desired.size && !container) createContainer();
    if (desired.size && !container!.isConnected) document.documentElement?.append(container!);
    let index = 0;
    for (const [tabId, item] of desired) {
      let card = cards.get(tabId);
      if (!card) { card = createCard(item); cards.set(tabId, card); }
      card.value = item;
      const description = labels[item.state];
      const site = `${item.domain ?? 'Unknown site'} · Tab ${tabId}`;
      const confidence = `Evidence score: ${Math.round(item.confidence * 100)}%`;
      card.heading.textContent = `AgentGuard · ${description}`;
      card.site.textContent = site;
      card.score.textContent = confidence;
      card.host.setAttribute('data-agentguard-alert', item.state);
      card.host.setAttribute('data-agentguard-tab-id', String(tabId));
      // Other tabs' domains stay inside the closed shadow, not page-readable host attributes.
      card.host.setAttribute('aria-label', `AgentGuard: ${description}. Tab ${tabId}. ${confidence}. Switch to tab ${tabId}.`);
      if (container!.children[index] !== card.host) {
        const focused = document.activeElement === card.host;
        container!.insertBefore(card.host, container!.children[index] ?? null);
        if (focused) card.host.focus({ preventScroll: true });
      }
      index++;
    }
    scheduleExpiry();
  };
  scope.__agentguardTabAlertV2__ = { render };
  render(input);
}
