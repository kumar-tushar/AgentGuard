import type { Request } from '../shared/contracts';
import { validateConfig } from '../enterprise/config';
import { domains, grantPreset } from '../delegation/store';
import { normalizeDomain } from '../shared/domains';

export function isTrustedUi(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url || (sender.frameId !== undefined && sender.frameId !== 0)) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId &&
      ['/popup.html', '/options.html', '/blocked.html'].includes(url.pathname);
  } catch { return false; }
}

export function parseRequest(value: unknown): Request {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request');
  const input = value as Record<string, unknown>;
  const only = (...keys: string[]) => {
    if (Object.keys(input).some((key) => !keys.includes(key))) throw new Error('Unexpected request field');
  };
  switch (input.type) {
    case 'GRANT_ONCE':
      only('type', 'tabId', 'capability');
      if (!Number.isInteger(input.tabId) || (input.tabId as number) < 0 || (input.tabId as number) > 2_147_483_647 ||
        typeof input.capability !== 'string' || !['click', 'type', 'submit', 'network', 'modify_dom', 'open_window', 'navigate'].includes(input.capability)) throw new Error('Invalid one-time allowance');
      return { type: input.type, tabId: input.tabId as number, capability: input.capability as 'click' | 'type' | 'submit' | 'network' | 'modify_dom' | 'open_window' | 'navigate' };
    case 'GRANT_DELEGATION':
      only('type', 'tabId', 'preset', 'allowedDomains', 'blockedDomains', 'minutes');
      if (!Number.isInteger(input.tabId) || (input.tabId as number) < 0 || (input.tabId as number) > 2_147_483_647 || !grantPreset(input.preset) ||
        !Number.isInteger(input.minutes) || (input.minutes as number) < 1 || (input.minutes as number) > 60) throw new Error('Invalid grant');
      return { type: input.type, tabId: input.tabId as number, preset: input.preset, allowedDomains: domains(input.allowedDomains), blockedDomains: domains(input.blockedDomains), minutes: input.minutes as number };
    case 'REVOKE_DELEGATION': case 'START_OBSERVATION': case 'STOP_OBSERVATION': case 'LOOKUP_TRUST': case 'LOOKUP_SITE_DECLARATION':
      only('type', 'tabId');
      if (!Number.isInteger(input.tabId) || (input.tabId as number) < 0 || (input.tabId as number) > 2_147_483_647) throw new Error('Invalid tab');
      return { type: input.type, tabId: input.tabId as number };
    case 'CONTRIBUTE_STATISTICS':
      only('type', 'consent');
      if (input.consent !== true) throw new Error('Explicit contribution consent required');
      return { type: input.type, consent: true };
    case 'PAUSE_CONTROLS':
      only('type', 'domain', 'minutes');
      if (input.domain !== null && typeof input.domain !== 'string') throw new Error('Invalid pause domain');
      if (!Number.isInteger(input.minutes) || (input.minutes as number) < 1 || (input.minutes as number) > 1440) throw new Error('Invalid pause');
      return { type: input.type, domain: input.domain === null ? null : normalizeDomain(input.domain as string), minutes: input.minutes as number };
    case 'RESUME_CONTROLS':
      only('type', 'pauseId');
      if (typeof input.pauseId !== 'string' || !/^[a-f0-9-]{36}$/u.test(input.pauseId)) throw new Error('Invalid pause ID');
      return { type: input.type, pauseId: input.pauseId };
    case 'EMERGENCY_ACTIVATE':
      only('type', 'action');
      if (input.action !== 'quarantine' && input.action !== 'close') throw new Error('Invalid emergency action');
      return { type: input.type, action: input.action };
    case 'EMERGENCY_RESET': case 'APPLY_UPDATE': case 'CLEAR_TRAFFIC':
      only('type');
      return { type: input.type };
    case 'GET_SESSION_REPORT':
      only('type', 'sessionId');
      if (typeof input.sessionId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(input.sessionId)) throw new Error('Invalid session ID');
      return { type: input.type, sessionId: input.sessionId };
    case 'GET_DASHBOARD': case 'EXPORT_AUDIT': case 'CLEAR_AUDIT':
    case 'GET_SESSION_HISTORY': case 'EXPORT_SESSIONS': case 'CLEAR_SESSION_HISTORY':
      only('type');
      return { type: input.type };
    case 'QUARANTINE_TAB': case 'RELEASE_TAB': case 'CLOSE_TAB':
      only('type', 'tabId');
      if (!Number.isSafeInteger(input.tabId) || (input.tabId as number) < 0 || (input.tabId as number) > 2_147_483_647) {
        throw new Error('Invalid tab ID');
      }
      return { type: input.type, tabId: input.tabId as number };
    case 'SAVE_CONFIG':
      only('type', 'config');
      return { type: input.type, config: validateConfig(input.config) };
    default: throw new Error('Unknown request');
  }
}
