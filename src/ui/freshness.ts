import { useEffect, useState } from 'react';
import type { TabAgentStatus } from '../shared/contracts';

function deadline(assessment: TabAgentStatus): number {
  return Math.min(assessment.expiresAt, ...assessment.evidence.map((item) => item.expiresAt));
}

/** Expire cached views even when an open UI receives no new background response. */
export function useCurrentAssessments(assessments: readonly TabAgentStatus[]): TabAgentStatus[] {
  const [lastTick, setLastTick] = useState(Date.now);
  const now = Math.max(lastTick, Date.now());
  const nextExpiry = Math.min(...assessments.map(deadline).filter((expiresAt) => expiresAt > now));

  useEffect(() => {
    const tick = () => setLastTick(Date.now());
    const timer = Number.isFinite(nextExpiry) ? window.setTimeout(tick, Math.max(0, nextExpiry - Date.now())) : undefined;
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [nextExpiry]);

  return assessments.map((assessment) => {
    if (deadline(assessment) > now) return assessment;
    const reason = 'Assessment expired. Awaiting new automatic monitoring evidence.';
    return {
      ...assessment,
      status: 'UNMONITORED',
      confidence: 0,
      identifiedAgent: null,
      frameworkHints: [],
      evidence: [],
      coverage: assessment.coverage.map((item) => ({ ...item, availability: 'unavailable', reason })),
      policy: { action: 'none', matchedDomain: null, reason },
    };
  });
}
