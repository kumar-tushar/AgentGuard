import type { AgentGuardConfig, EffectiveConfig } from '../shared/contracts';
import { DEFAULT_CONFIG, validateConfig } from '../enterprise/config';

/** Keep local preferences underneath managed overrides, including after policy removal. */
export function localPreferencesForSave(requested: AgentGuardConfig, stored: unknown, effective: EffectiveConfig): AgentGuardConfig {
  const clean = validateConfig(requested);
  let local = DEFAULT_CONFIG;
  try { if (stored !== undefined) local = validateConfig(stored); } catch { /* Saving can repair an invalid local configuration. */ }
  const result: Record<string, unknown> = { ...clean };
  for (const key of effective.managedKeys) {
    if (JSON.stringify(clean[key]) !== JSON.stringify(effective.values[key])) throw new Error('Administrator-managed settings cannot be changed.');
    result[key] = local[key];
  }
  return validateConfig(result);
}
