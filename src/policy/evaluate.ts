import type { AgentGuardConfig, PolicyDecision, TabAgentStatus } from '../shared/contracts';
import { matchesDomain, normalizeDomain } from '../shared/domains';
import { hasAutomation } from '../shared/intelligence';

type PolicyInput = Pick<TabAgentStatus, 'domain' | 'status' | 'confidence'>;

/** Detection is upstream; this function only maps a known status to a policy action. */
export function evaluatePolicy(tab: PolicyInput, config: AgentGuardConfig): PolicyDecision {
  const none = (reason: string): PolicyDecision => ({ action: 'none', reason, matchedDomain: null });
  if (!config.monitoringEnabled) return none('Monitoring is disabled');
  if (!tab.domain) return none('Tab domain is unavailable');
  let host: string;
  try {
    host = normalizeDomain(tab.domain);
  } catch {
    return none('Tab domain is invalid');
  }
  const matchedDomain = config.sensitiveDomains.find((rule) => matchesDomain(host, rule)) ?? null;
  if (!matchedDomain) return none('Domain is not sensitive');
  if (!hasAutomation(tab.status)) {
    return { action: 'none', reason: 'No positive automation assessment', matchedDomain };
  }
  if (!Number.isFinite(tab.confidence) || tab.confidence < config.minimumConfidence) {
    return { action: 'none', reason: 'Confidence below policy threshold', matchedDomain };
  }
  const action = config.policyMode === 'block' ? 'quarantine' : config.policyMode;
  return { action, reason: `Automation evidence on sensitive domain: ${tab.status}`, matchedDomain };
}
