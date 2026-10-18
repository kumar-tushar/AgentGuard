import { describe, expect, it } from 'vitest';
import { DocumentActivity } from '../src/background/activity';
import type { SensorSignal } from '../src/background/sensor-messages';

function signal(sequence = 1, observedAt = 20_000): SensorSignal {
  return { type: 'SENSOR_SIGNAL', schemaVersion: 1, sequence, reason: 'interaction', observedAt,
    visibility: 'visible', counts: { pointer: 2, keyboard: 3, input: 1, submit: 0, scroll: 1, focus: 0,
      trusted: 7, synthetic: 0, hiddenTrusted: 0 }, lastActivityAt: observedAt };
}
describe('document-bound activity', () => {
  it('aggregates accepted batches once and preserves newer in-flight deltas', () => {
    const store = new DocumentActivity();
    store.add(1, 'doc', signal());
    store.add(1, 'doc', signal());
    store.add(1, 'doc', signal(2, 21_000));
    expect(store.take(1, 'doc', 20_000)).toMatchObject({ activityDelta: { pointerInteractions: 2, keyboardInteractions: 3 }, lastActivityAt: 20_000 });
    expect(store.take(1, 'doc', 21_000).activityDelta.pointerInteractions).toBe(2);
    expect(store.take(1, 'doc', 21_001)).toMatchObject({ activityDelta: { pointerInteractions: 0 }, lastActivityAt: null });
  });
  it('never carries stale or previous-document activity into a new session', () => {
    const store = new DocumentActivity();
    store.add(1, 'old', signal());
    expect(store.take(1, 'new', 20_001).lastActivityAt).toBeNull();
    store.add(1, 'new', signal());
    expect(store.take(1, 'new', 30_001).activityDelta.keyboardInteractions).toBe(0);
    store.add(1, 'new', signal());
    store.forget(1);
    expect(store.take(1, 'new', 20_000).lastActivityAt).toBeNull();
  });
});
