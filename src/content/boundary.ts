import type { ActionCapability, BoundaryRule, OneTimeAllowance } from '../shared/controls';

/** Serialized into ISOLATED world. No targets, values, keys or DOM contents are read. */
export function installInteractionBoundary(rule: BoundaryRule): void {
  const scope = globalThis as typeof globalThis & { __agentguardInteractionBoundaryV1__?: { update(rule: BoundaryRule): void; grant(allowance: OneTimeAllowance | null): boolean } };
  if (scope.__agentguardInteractionBoundaryV1__) { scope.__agentguardInteractionBoundaryV1__.update(rule); return; }
  if (!rule.blocked.length) return;
  let current = rule;
  let lastTrustedAt = 0;
  let once: OneTimeAllowance | null = null;
  const issued = new Map<string, number>();
  const capabilities: Record<string, ActionCapability> = { click: 'click', keydown: 'type', beforeinput: 'type', input: 'type', submit: 'submit' };
  const listener = (event: Event) => {
    const now = Date.now();
    if (event.isTrusted) { lastTrustedAt = now; return; }
    // Ordinary apps dispatch synthetic events immediately after human/native input.
    if (now - lastTrustedAt < 150 || current.expiresAt <= now || !current.blocked.includes(capabilities[event.type]!)) return;
    if (once && once.expiresAt > now && once.capability === capabilities[event.type]) { once = null; return; }
    event.preventDefault(); event.stopImmediatePropagation();
  };
  for (const type of Object.keys(capabilities)) document.addEventListener(type, listener, { capture: true });
  scope.__agentguardInteractionBoundaryV1__ = {
    update(next) { if (next.revision >= current.revision) { if (next.revision !== current.revision) once = null; current = next; } },
    grant(allowance) {
      if (!allowance) { once = null; return true; }
      const now = Date.now();
      for (const [id, expiry] of issued) if (expiry <= now) issued.delete(id);
      if (issued.has(allowance.id) || issued.size >= 100 || allowance.expiresAt <= now || allowance.expiresAt > now + 60_000 || !['click', 'type', 'submit'].includes(allowance.capability) || !current.blocked.includes(allowance.capability)) return false;
      issued.set(allowance.id, allowance.expiresAt); once = allowance; return true;
    },
  };
}

/** Page-world wrapping is best effort, never a native-input or DLP boundary. */
export function installApiBoundary(rule: BoundaryRule): void {
  const scope = globalThis as typeof globalThis & { __agentguardApiBoundaryV1__?: { update(rule: BoundaryRule): void; grant(allowance: OneTimeAllowance | null): boolean } };
  if (scope.__agentguardApiBoundaryV1__) { scope.__agentguardApiBoundaryV1__.update(rule); return; }
  if (!rule.blocked.length) return;
  let current = rule;
  let once: OneTimeAllowance | null = null;
  const issued = new Map<string, number>();
  const isAutomationCall = () => {
    try { return /\bUtilityScript\.(?:evaluate|callFunction)\b|pptr:(?:evaluate|evaluateHandle)|__puppeteer_evaluation_script__/u.test(new Error().stack ?? ''); }
    catch { return false; }
  };
  const blocked = (capability: ActionCapability) => {
    if (current.expiresAt <= Date.now() || !current.blocked.includes(capability) || !isAutomationCall()) return false;
    if (once && once.expiresAt > Date.now() && once.capability === capability) { once = null; return false; }
    return true;
  };
  const wrap = (object: object, key: string, capability: ActionCapability) => {
    const original = Reflect.get(object, key) as unknown;
    if (typeof original !== 'function') return;
    Reflect.set(object, key, function(this: unknown, ...args: unknown[]) {
      if (blocked(capability)) throw new DOMException('AgentGuard delegation blocked this in-page operation. Native driver activity is outside this boundary.', 'NotAllowedError');
      return Reflect.apply(original, this, args);
    });
  };
  wrap(window, 'open', 'open_window');
  wrap(history, 'pushState', 'navigate'); wrap(history, 'replaceState', 'navigate');
  wrap(HTMLFormElement.prototype, 'submit', 'submit'); wrap(HTMLFormElement.prototype, 'requestSubmit', 'submit');
  wrap(window, 'fetch', 'network'); wrap(XMLHttpRequest.prototype, 'open', 'network'); wrap(navigator, 'sendBeacon', 'network');
  wrap(Element.prototype, 'insertAdjacentHTML', 'modify_dom');
  wrap(Document.prototype, 'write', 'modify_dom'); wrap(Document.prototype, 'writeln', 'modify_dom');
  scope.__agentguardApiBoundaryV1__ = {
    update(next) { if (next.revision >= current.revision) { if (next.revision !== current.revision) once = null; current = next; } },
    grant(allowance) {
      if (!allowance) { once = null; return true; }
      const now = Date.now();
      for (const [id, expiry] of issued) if (expiry <= now) issued.delete(id);
      if (issued.has(allowance.id) || issued.size >= 100 || allowance.expiresAt <= now || allowance.expiresAt > now + 60_000 || !['network', 'modify_dom', 'open_window', 'navigate'].includes(allowance.capability) || !current.blocked.includes(allowance.capability)) return false;
      issued.set(allowance.id, allowance.expiresAt); once = allowance; return true;
    },
  };
}

/** Runs in exactly one selected realm, never grants the same token to both paths. */
export function grantBoundaryOnce(allowance: OneTimeAllowance | null, realm: 'interaction' | 'api'): boolean {
  const scope = globalThis as typeof globalThis & { __agentguardInteractionBoundaryV1__?: { grant(allowance: OneTimeAllowance | null): boolean }; __agentguardApiBoundaryV1__?: { grant(allowance: OneTimeAllowance | null): boolean } };
  return (realm === 'interaction' ? scope.__agentguardInteractionBoundaryV1__ : scope.__agentguardApiBoundaryV1__)?.grant(allowance) ?? false;
}
