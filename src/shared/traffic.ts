export interface TrafficRecord {
  id: string;
  timestamp: number;
  tabId: number;
  domain: string;
  kind: 'request' | 'response' | 'download_started';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'OTHER';
  status: number | null;
  initiator: 'unknown';
}
export interface ObservationLease {
  tabId: number;
  state: 'starting' | 'observing' | 'unavailable';
  expiresAt: number;
  reason: string;
}
export interface TrafficView { leases: ObservationLease[]; records: TrafficRecord[] }
export type DownloadPolicy = 'off' | 'observe' | 'block_all';
export interface DownloadRecord {
  id: number;
  timestamp: number;
  domain: string | null;
  tabId: null;
  initiator: 'unknown';
  action: 'observed' | 'cancel_confirmed' | 'cancel_failed';
}
