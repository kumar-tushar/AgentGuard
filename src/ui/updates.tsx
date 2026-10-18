import { useState } from 'react';
import type { PendingUpdate } from '../shared/updates';
import { errorText, send } from './client';
import { Notice } from './components';

export function UpdateNotice({ update }: { update: PendingUpdate | null | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const apply = async () => {
    if (!window.confirm('Reload AgentGuard to apply the staged update? Extension views will close and page-level controls can be briefly interrupted.')) return;
    try { await send({ type: 'APPLY_UPDATE' }); } catch (cause) { setError(errorText(cause)); }
  };
  return <>{error && <Notice tone="error">{error}</Notice>}{update && <Notice tone="warning">Update {update.version} is staged. Automatic application waits for active controls to end. <button className="text-button" onClick={() => void apply()}>Apply update now</button></Notice>}</>;
}
