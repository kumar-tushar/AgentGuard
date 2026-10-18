import type { AgentSession } from '../shared/intelligence';
import type { SessionSummaryReport } from '../shared/reports';
import { parseAgentSession } from '../background/agent-sessions';

export function summarizeSession(input: AgentSession, now = Date.now()): SessionSummaryReport {
  const session = parseAgentSession(input, now);
  if (!session) throw new Error('Invalid session report source');
  return {
    schemaVersion: 1, sessionId: session.id, tabId: session.tabId, domain: session.domain,
    controlState: session.controlState, controller: null, frameworkHints: session.automationStack.frameworks,
    startedAt: session.startedAt, endedAt: session.endedAt,
    observedDurationMs: Math.max(0, (session.endedAt ?? Math.min(session.lastObservedAt, now)) - session.startedAt),
    activity: session.observedActivity, evidenceIds: session.evidenceIds,
    controlScore: session.controlScore, coverageScore: session.coverageScore,
    timelineEvents: session.timeline.length,
    containmentEvents: session.timeline.filter(event => event.kind === 'CONTAINED').length,
    boundaryViolations: session.timeline.filter(event => event.type === 'boundary_violation').length,
    coverageNote: 'Observed tab activity is not attributed to an AI controller. Native CDP, accessibility and OS input may be indistinguishable from user activity. Missing samples and zero counts do not establish inactivity. Duration is the observation window, not an exact controller connection duration. Timeline totals cover retained events only; page-boundary violations are not comprehensively collected and a zero total does not prove no violation.',
  };
}
