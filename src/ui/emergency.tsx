import { useState } from 'react';
import type { EmergencyState } from '../shared/emergency';
import { errorText, send } from './client';
import { Notice } from './components';

export function EmergencyControls({ state, onChanged }: { state: EmergencyState | undefined; onChanged(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'quarantine' | 'close' | 'reset') => {
    if (action !== 'reset' && !window.confirm(action === 'close'
      ? 'Close all currently detected automation tabs? Unsaved work may be lost. Detection can include ordinary DevTools. This does not terminate an external controller.'
      : 'Quarantine all currently detected automation tabs and activate the emergency latch? Pages will be replaced and unsaved work may be lost. New detections will also be quarantined until reset.')) return;
    setBusy(true); setError(null);
    try {
      if (action === 'reset') await send({ type: 'EMERGENCY_RESET' });
      else await send({ type: 'EMERGENCY_ACTIVATE', action });
      onChanged();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <section className="panel action-panel" aria-label="Emergency controls"><h2>Emergency controls</h2>
    {error && <Notice tone="error">{error}</Notice>}
    {state?.active && <Notice tone="warning">Emergency latch active. Reset stops automatic emergency containment; existing quarantines must be released separately.</Notice>}
    {state?.active && state.grantsRevoked === false && <Notice tone="error">Delegation cleanup was not confirmed. Containment was still attempted; retry containment and review each outcome.</Notice>}
    <div className="action-row"><button className="button button-danger" disabled={busy} onClick={() => void act('quarantine')}>Contain detected tabs</button><button className="button button-outline" disabled={busy} onClick={() => void act('close')}>Close detected tabs</button>{state?.active && <button className="button button-outline" disabled={busy} onClick={() => void act('reset')}>Reset emergency latch</button>}</div>
    <p className="muted small">Shortcut: Ctrl+Shift+K (Command+Shift+K on Mac). Chrome may leave a conflicting shortcut unassigned; configure it in chrome://extensions/shortcuts. It cannot terminate an external automation process.</p>
    {Boolean(state?.outcomes.length) && <ul>{state!.outcomes.map((outcome, index) => <li key={index}>Tab {outcome.tabId} · {outcome.domain ?? 'Unknown domain'} · {outcome.action}: {outcome.result === 'confirmed' ? 'confirmed' : 'not confirmed'}</li>)}</ul>}
  </section>;
}
