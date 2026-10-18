export interface EmergencyOutcome {
  tabId: number;
  domain: string | null;
  action: 'quarantine' | 'close';
  result: 'confirmed' | 'failed';
  timestamp: number;
}
export interface EmergencyState {
  schemaVersion: 1;
  active: boolean;
  activatedAt: number | null;
  outcomes: EmergencyOutcome[];
  grantsRevoked?: boolean;
}
