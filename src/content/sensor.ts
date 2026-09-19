/** Serialized as a self-contained classic script; runs only in Chrome's ISOLATED world. */
export function installSensor(): void {
  const scope = globalThis as typeof globalThis & { __agentguardSensorV2__?: { refresh(): void } };
  if (scope.__agentguardSensorV2__) { scope.__agentguardSensorV2__.refresh(); return; }
  const events = ['pointerdown', 'click', 'keydown', 'beforeinput', 'input', 'submit', 'scroll', 'focusin'] as const;
  let enabled = false;
  let sequence = 0;
  let lastSentAt = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let counts = { pointer: 0, keyboard: 0, input: 0, submit: 0, scroll: 0, focus: 0, trusted: 0, synthetic: 0, hiddenTrusted: 0 };
  let lastActivityAt: number | null = null;
  const reset = () => { counts = { pointer: 0, keyboard: 0, input: 0, submit: 0, scroll: 0, focus: 0, trusted: 0, synthetic: 0, hiddenTrusted: 0 }; lastActivityAt = null; };
  const receive = (response: unknown) => {
    const value = response as { ok?: boolean; monitoringEnabled?: boolean; behaviorEnabled?: boolean } | undefined;
    enabled = value?.ok === true && value.monitoringEnabled === true && value.behaviorEnabled === true;
    if (!enabled) reset();
    if (expiry !== undefined) clearTimeout(expiry);
    // Missing worker/config acknowledgement stops collection; the alarm can renew it.
    expiry = setTimeout(() => { enabled = false; reset(); }, 100_000);
  };
  const send = (reason: 'ready' | 'interaction' | 'visibility' | 'lifecycle') => {
    pending = undefined;
    const now = Date.now();
    lastSentAt = now;
    const packet = { type: 'SENSOR_SIGNAL', schemaVersion: 1, sequence: ++sequence, reason,
      observedAt: now, visibility: document.visibilityState === 'hidden' ? 'hidden' : 'visible', counts: { ...counts }, lastActivityAt };
    reset();
    try { void chrome.runtime.sendMessage(packet).then(receive, () => { enabled = false; reset(); }); }
    catch { enabled = false; reset(); }
  };
  const schedule = (reason: 'interaction' | 'visibility' | 'lifecycle') => {
    if (pending !== undefined) return;
    pending = setTimeout(() => send(reason), Math.max(200, 1500 - (Date.now() - lastSentAt)));
  };
  const record = (kind: typeof events[number], event: Event) => {
    if (!enabled) return;
    // Deliberately do not access event.target, key, value, coordinates, selectors or page text.
    const trusted = event.isTrusted;
    const bucket = kind === 'pointerdown' || kind === 'click' ? 'pointer' : kind === 'keydown' ? 'keyboard'
      : kind === 'input' || kind === 'beforeinput' ? 'input' : kind === 'focusin' ? 'focus' : kind;
    counts[bucket] = Math.min(64, counts[bucket] + 1);
    if (trusted) counts.trusted = Math.min(64, counts.trusted + 1);
    else counts.synthetic = Math.min(64, counts.synthetic + 1);
    if (trusted && document.visibilityState === 'hidden') counts.hiddenTrusted = Math.min(64, counts.hiddenTrusted + 1);
    lastActivityAt = Date.now();
    schedule('interaction');
  };
  for (const kind of events) document.addEventListener(kind, event => record(kind, event), { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => schedule('visibility'));
  window.addEventListener('pageshow', () => schedule('lifecycle'));
  window.addEventListener('popstate', () => schedule('lifecycle'));
  scope.__agentguardSensorV2__ = { refresh: () => schedule('lifecycle') };
  send('ready');
}
