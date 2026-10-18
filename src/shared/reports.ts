import type { ActivityCounters, ControlState, Framework } from './intelligence';

export interface SessionSummaryReport {
  schemaVersion: 1;
  sessionId: string;
  tabId: number;
  domain: string | null;
  controlState: ControlState;
  controller: null;
  frameworkHints: Framework[];
  startedAt: number;
  endedAt: number | null;
  observedDurationMs: number;
  activity: ActivityCounters;
  evidenceIds: string[];
  controlScore: number;
  coverageScore: number;
  timelineEvents: number;
  containmentEvents: number;
  boundaryViolations: number;
  coverageNote: string;
}

export interface BrowserStatistics {
  firstSessionAt: number | null;
  sessionsObserved: number;
  confirmedContainments: number;
  frameworks: Partial<Record<Framework, number>>;
}
