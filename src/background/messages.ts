import type { Request } from '../shared/contracts';
import { validateConfig } from '../enterprise/config';

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
