// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPageReturn } from '../src/ui/page-return';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('private containment-page history command', () => {
  function setup() {
    const addListener = vi.fn(), removeListener = vi.fn();
    vi.stubGlobal('chrome', { runtime: { id: 'ours', getURL: (path: string) => `chrome-extension://ours/${path}`, onMessage: { addListener, removeListener } } });
    // The Navigation API cannot see the previous cross-origin web page.
    vi.stubGlobal('navigation', { canGoBack: false });
    vi.spyOn(history, 'length', 'get').mockReturnValue(2);
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const uninstall = installPageReturn(7);
    const listener = addListener.mock.calls[0]![0] as (input: unknown, sender: chrome.runtime.MessageSender, respond: (input: unknown) => void) => boolean;
    return { listener, back, uninstall, removeListener, respond: vi.fn(),
      sender: { id: 'ours', url: 'chrome-extension://ours/background.js' },
      command: { type: 'RETURN_TO_PREVIOUS_PAGE', tabId: 7, nonce: crypto.randomUUID() } };
  }
  it('navigates exactly one script-history entry only on an authenticated worker request', () => {
    const value = setup();
    value.listener(value.command, value.sender, value.respond);
    expect(value.back).toHaveBeenCalledOnce();
    expect(value.respond).toHaveBeenCalledWith({ nonce: value.command.nonce, navigation: 'requested' });
    value.uninstall(); expect(value.removeListener).toHaveBeenCalledWith(value.listener);
  });
  it('rejects content scripts, other UI senders, wrong tabs and forged fields without navigating', () => {
    const value = setup();
    for (const sender of [{ id: 'ours', url: 'https://example.com' }, { id: 'ours', url: 'chrome-extension://ours/popup.html' }, { id: 'theirs', url: value.sender.url }, { ...value.sender, tab: { id: 7 } }]) value.listener(value.command, sender as chrome.runtime.MessageSender, value.respond);
    value.listener({ ...value.command, tabId: 8 }, value.sender, value.respond);
    value.listener({ ...value.command, url: 'https://untrusted.example' }, value.sender, value.respond);
    expect(value.back).not.toHaveBeenCalled(); expect(value.respond).not.toHaveBeenCalled();
  });
  it('reports unavailable history or navigation failure without claiming return', () => {
    const value = setup(); vi.spyOn(history, 'length', 'get').mockReturnValue(1);
    value.listener(value.command, value.sender, value.respond);
    expect(value.back).not.toHaveBeenCalled();
    expect(value.respond).toHaveBeenLastCalledWith({ nonce: value.command.nonce, navigation: 'unavailable' });
    vi.spyOn(history, 'length', 'get').mockReturnValue(2); value.back.mockImplementation(() => { throw new Error('history failed'); });
    value.listener(value.command, value.sender, value.respond);
    expect(value.respond).toHaveBeenLastCalledWith({ nonce: value.command.nonce, navigation: 'unavailable' });
  });
});
