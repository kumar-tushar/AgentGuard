import { ACTIVITY_KEYS, emptyActivity, type ActivityCounters } from '../shared/intelligence';
import { activityFromSignal, type SensorSignal } from './sensor-messages';

interface Batch { documentId: string; sequence: number; observedAt: number; lastActivityAt: number | null; counts: ActivityCounters }
/** Accepted deltas are consumed once, never inferred from rolling detector totals. */
export class DocumentActivity {
  private entries = new Map<number, Batch[]>();

  add(tabId: number, documentId: string, signal: SensorSignal): void {
    if (!this.entries.has(tabId) && this.entries.size >= 500) this.entries.delete(this.entries.keys().next().value!);
    const batches = this.entries.get(tabId)?.filter(batch => batch.documentId === documentId &&
      batch.observedAt >= signal.observedAt - 10_000) ?? [];
    if (batches.some(batch => batch.sequence >= signal.sequence)) return;
    batches.push({ documentId, sequence: signal.sequence, observedAt: signal.observedAt,
      lastActivityAt: signal.lastActivityAt, counts: activityFromSignal(signal) });
    this.entries.set(tabId, batches.slice(-16));
  }

  take(tabId: number, documentId: string, observedAt: number): { activityDelta: ActivityCounters; lastActivityAt: number | null } {
    const batches = this.entries.get(tabId) ?? [];
    const eligible = batches.filter(batch => batch.documentId === documentId && batch.observedAt <= observedAt &&
      batch.observedAt >= observedAt - 10_000);
    this.entries.set(tabId, batches.filter(batch => batch.documentId === documentId && batch.observedAt > observedAt));
    if (!this.entries.get(tabId)!.length) this.entries.delete(tabId);
    const activityDelta = emptyActivity();
    let lastActivityAt: number | null = null;
    for (const batch of eligible) {
      for (const key of ACTIVITY_KEYS) activityDelta[key] = Math.min(1_000_000_000, activityDelta[key] + batch.counts[key]);
      if (batch.lastActivityAt !== null) lastActivityAt = Math.max(lastActivityAt ?? 0, batch.lastActivityAt);
    }
    return { activityDelta, lastActivityAt };
  }

  forget(tabId: number): void { this.entries.delete(tabId); }
  clear(): void { this.entries.clear(); }
}
