import type { ActivityCounters } from '../shared/intelligence';
import { emptyActivity } from '../shared/intelligence';

export interface SensorSignal {
  type: 'SENSOR_SIGNAL'; schemaVersion: 1; sequence: number;
  reason: 'ready' | 'interaction' | 'visibility' | 'lifecycle';
  observedAt: number; visibility: 'hidden' | 'visible';
  counts: { pointer: number; keyboard: number; input: number; submit: number; scroll: number; focus: number; trusted: number; synthetic: number; hiddenTrusted: number };
  lastActivityAt: number | null;
}
const KEYS = ['type', 'schemaVersion', 'sequence', 'reason', 'observedAt', 'visibility', 'counts', 'lastActivityAt'];
const COUNTS = ['pointer', 'keyboard', 'input', 'submit', 'scroll', 'focus', 'trusted', 'synthetic', 'hiddenTrusted'];
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
export function parseSensorSignal(value: unknown, now: number): SensorSignal | null {
  if (!record(value) || !exact(value, KEYS) || value.type !== 'SENSOR_SIGNAL' || value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 ||
      !['ready', 'interaction', 'visibility', 'lifecycle'].includes(String(value.reason)) ||
      !Number.isSafeInteger(value.observedAt) || (value.observedAt as number) > now + 1000 || (value.observedAt as number) < now - 10_000 ||
      (value.visibility !== 'hidden' && value.visibility !== 'visible') || !record(value.counts) || !exact(value.counts, COUNTS)) return null;
  const counts = value.counts;
  if (COUNTS.some(key => !Number.isInteger(counts[key]) || (counts[key] as number) < 0 || (counts[key] as number) > 64)) return null;
  if ((counts.hiddenTrusted as number) > (counts.trusted as number) ||
      (value.lastActivityAt !== null && (!Number.isSafeInteger(value.lastActivityAt) ||
        (value.lastActivityAt as number) > (value.observedAt as number) || (value.lastActivityAt as number) < now - 10_000))) return null;
  return structuredClone(value) as unknown as SensorSignal;
}

/** Chrome-provided sender fields bind signals to one top-frame document, not page-supplied IDs. */
export function sensorSender(sender: chrome.runtime.MessageSender, extensionId: string): { tabId: number; documentId: string } | null {
  if (sender.id !== extensionId || sender.frameId !== 0 || !Number.isSafeInteger(sender.tab?.id) || sender.tab!.id! < 0 || sender.tab!.id! > 2_147_483_647 ||
      typeof sender.documentId !== 'string' || sender.documentId.length > 100 || !sender.documentId ||
      sender.documentLifecycle !== 'active' || !sender.url) return null;
  try {
    if (!['http:', 'https:'].includes(new URL(sender.url).protocol)) return null;
  } catch { return null; }
  return { tabId: sender.tab!.id!, documentId: sender.documentId };
}

/** Bounded anti-replay/rate gate; no URL or page-controlled text is stored. */
export class SensorGate {
  private readonly entries = new Map<number, { documentId: string; sequence: number; at: number }>();
  accept(tabId: number, documentId: string, signal: SensorSignal, now: number): boolean {
    const previous = this.entries.get(tabId);
    if (previous && previous.documentId === documentId && (signal.sequence <= previous.sequence || now - previous.at < 1000)) return false;
    if (!previous && this.entries.size >= 1000) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(tabId, { documentId, sequence: signal.sequence, at: now });
    return true;
  }
  forget(tabId: number): void { this.entries.delete(tabId); }
}

export function activityFromSignal(signal: SensorSignal): ActivityCounters {
  return { ...emptyActivity(), pointerInteractions: signal.counts.pointer, keyboardInteractions: signal.counts.keyboard,
    inputInteractions: signal.counts.input, scrolls: signal.counts.scroll, submits: signal.counts.submit,
    syntheticInteractions: signal.counts.synthetic };
}
