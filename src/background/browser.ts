import { collectRuntime } from '../content/runtime';
import { collectBehavior } from '../content/behavior';
import type { Capabilities, DetectionContext, PolicyAction } from '../shared/contracts';
import type { ControlState } from '../shared/intelligence';
import { normalizeRuntime, normalizeBehavior } from '../detection/validation';

/** Own extension tabs can lack tabs.Tab.url without the broad tabs permission. */
export async function readTab(tabId: number): Promise<{ url?: string; status?: string }> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) return { url: tab.url, status: tab.status };
  const contexts = await chrome.runtime.getContexts({ tabIds: [tabId], contextTypes: [chrome.runtime.ContextType.TAB] });
  const ownContext = contexts.find((context) => context.documentUrl?.startsWith(chrome.runtime.getURL('')));
  return { url: ownContext?.documentUrl, status: tab.status };
}

export async function capabilities(snapshot?: DebuggerSnapshot): Promise<Capabilities> {
  const [granted, debuggerSnapshot] = await Promise.all([
    chrome.permissions.getAll(),
    snapshot ?? captureDebuggerSnapshot(),
  ]);
  const origins = (granted.origins ?? []).filter((origin) => /^https?:\/\//.test(origin));
  return {
    debugger: debuggerSnapshot.available,
    networkBlocking: Boolean(granted.permissions?.includes('declarativeNetRequestWithHostAccess') && origins.length),
    origins,
  };
}

export async function within<T>(work: Promise<T>, milliseconds = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Observation timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export interface DebuggerSnapshot {
  capturedAt: number;
  targets: ReadonlyArray<{ id: string; type: string; tabId?: number; attached: boolean }>;
  available: boolean;
  reason: string;
}

const DEBUGGER_UNAVAILABLE = 'Reduced coverage: debugger access unavailable; Chrome or organization policy may restrict it, or inspection failed.';
let targetsCache: { at: number; promise: Promise<DebuggerSnapshot> } | undefined;

/** One privacy-filtered browser-wide capture may be shared across an entire reconciliation. */
export function captureDebuggerSnapshot(force = false): Promise<DebuggerSnapshot> {
  const capturedAt = Date.now();
  if (force || !targetsCache || capturedAt - targetsCache.at > 2000) {
    const promise = (async (): Promise<DebuggerSnapshot> => {
      try {
        const raw: unknown = await within(chrome.debugger.getTargets());
        if (!Array.isArray(raw)) throw new Error('Malformed debugger target list');
        const targets = raw.map((target: unknown) => {
          if (!target || typeof target !== 'object') throw new Error('Malformed debugger target');
          const item = target as Record<string, unknown>;
          if (typeof item.id !== 'string' || !item.id || typeof item.type !== 'string' || !item.type ||
              typeof item.attached !== 'boolean' || (item.tabId !== undefined &&
                (typeof item.tabId !== 'number' || !Number.isInteger(item.tabId) || item.tabId < 0 || item.tabId > 2_147_483_647))) {
            throw new Error('Malformed debugger target');
          }
          // Do not retain URLs, titles, extension IDs, or any additional target fields.
          return { id: item.id, type: item.type, attached: item.attached,
            ...(typeof item.tabId === 'number' ? { tabId: item.tabId } : {}) };
        });
        return { capturedAt, targets, available: true, reason: 'Attachment visibility does not identify a debugger owner.' };
      } catch {
        // Failure is also cached: denied access must not cause one request per tab.
        return { capturedAt, targets: [], available: false, reason: DEBUGGER_UNAVAILABLE };
      }
    })();
    targetsCache = { at: capturedAt, promise };
  }
  return targetsCache.promise;
}

async function debuggerState(tabId: number, snapshot?: DebuggerSnapshot): Promise<Pick<DetectionContext, 'debuggerAttached' | 'debuggerReason'>> {
  const current = snapshot ?? await captureDebuggerSnapshot();
  if (!current.available) return { debuggerAttached: null, debuggerReason: current.reason };
  const target = current.targets.find((item) => item.type === 'page' && item.tabId === tabId);
  return target
    ? { debuggerAttached: target.attached, debuggerReason: current.reason }
    : { debuggerAttached: null, debuggerReason: 'No inspectable page target was returned.' };
}

export async function observe(tabId: number, behaviorEnabled: boolean, now: number, debuggerSnapshot?: DebuggerSnapshot): Promise<DetectionContext> {
  const [runtime, behavior, debuggerResult] = await Promise.allSettled([
    within(chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: collectRuntime })),
    within(chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: collectBehavior, args: [behaviorEnabled, now] })),
    debuggerState(tabId, debuggerSnapshot),
  ]);
  const main = runtime.status === 'fulfilled' ? runtime.value.find((result) => result.frameId === 0) : undefined;
  const isolated = behavior.status === 'fulfilled' ? behavior.value.find((result) => result.frameId === 0) : undefined;
  const sameDocument = main?.documentId && isolated?.documentId && main.documentId === isolated.documentId;
  const snapshot = main ? normalizeRuntime(main.result) : null;
  return {
    now,
    runtime: snapshot,
    behavior: sameDocument && isolated ? normalizeBehavior(isolated.result, now) : null,
    runtimeReason: snapshot ? 'Top-frame runtime inspected; page-controlled signals can be spoofed.' : 'Runtime unavailable: permission, restricted page, navigation or malformed response.',
    ...(debuggerResult.status === 'fulfilled' ? debuggerResult.value : { debuggerAttached: null, debuggerReason: 'Debugger inspection unavailable.' }),
  };
}

export async function stopBehavior(tabId: number): Promise<void> {
  await within(chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: collectBehavior, args: [false, Date.now()] }));
}

export function canObserve(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname !== 'chromewebstore.google.com' &&
      !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'));
  } catch { return false; }
}

const BADGE_STATES: Record<ControlState, { text: string; label: string; color: string }> = {
  AGENT_ACTIVE: { text: 'ACT', label: 'Agent active', color: '#b9364c' },
  AGENT_CONNECTED: { text: 'CONN', label: 'Agent connected', color: '#9b6515' },
  AUTOMATION_LIKELY: { text: 'AUTO', label: 'Automation likely', color: '#b9364c' },
  AUTOMATION_SUSPECTED: { text: '?', label: 'Automation suspected', color: '#9b6515' },
  NO_AUTOMATION_OBSERVED: { text: '·', label: 'No automation observed', color: '#355366' },
  UNMONITORED: { text: '—', label: 'Unmonitored', color: '#355366' },
};

export async function updateBadge(tabId: number, status: ControlState, quarantined = false, policy: PolicyAction = 'none'): Promise<void> {
  const badge = BADGE_STATES[status];
  const text = quarantined ? 'STOP' : policy === 'warn' ? 'WARN' : badge.text;
  const color = quarantined ? '#b9364c' : badge.color;
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setTitle({ tabId, title: quarantined ? 'AgentGuard · Quarantine requested · Open to verify containment' : `AgentGuard · Last assessment: ${badge.label} · Open for current evidence and limitations` });
}
