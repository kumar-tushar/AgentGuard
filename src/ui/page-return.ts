/** Private worker→packaged containment-page command, not a page/content-script API. */
export function installPageReturn(tabId: number): () => void {
  const listener = (input: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void): false => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js') || sender.tab ||
      !input || typeof input !== 'object' || Array.isArray(input)) return false;
    const command = input as Record<string, unknown>;
    if (command.type !== 'RETURN_TO_PREVIOUS_PAGE' || command.tabId !== tabId ||
      Object.keys(command).length !== 3 || typeof command.nonce !== 'string' || !/^[a-f0-9-]{36}$/u.test(command.nonce)) return false;
    let navigation: 'requested' | 'unavailable' = 'unavailable';
    try {
      // navigation.canGoBack hides cross-origin entries, including the real web
      // page before this extension document. Do not use it to gate history.back.
      if (history.length > 1) {
        // Script history.back advances one entry, unlike toolbar-style Back,
        // which can skip entries with no prior user interaction.
        history.back(); navigation = 'requested';
      }
    } catch { /* A history failure is not a successful return. */ }
    respond({ nonce: command.nonce, navigation });
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
