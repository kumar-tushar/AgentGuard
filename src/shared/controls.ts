export type GrantPreset = 'READ_ONLY' | 'LIMITED' | 'FULL_ACCESS';
export type ActionCapability = 'click' | 'type' | 'submit' | 'navigate' | 'open_window' | 'network' | 'download' | 'modify_dom';
export interface ControlGrant {
  id: string; tabId: number; preset: GrantPreset; allowedDomains: string[]; blockedDomains: string[];
  createdAt: number; expiresAt: number;
}
export interface ControlPause { id: string; domain: string | null; createdAt: number; expiresAt: number }
export interface ControlLog { timestamp: number; type: 'granted' | 'revoked' | 'paused' | 'resumed' | 'expired' | 'emergency_reset'; tabId: number | null; domain: string | null }
export interface ControlsView { schemaVersion: 1; grants: ControlGrant[]; pauses: ControlPause[]; log: ControlLog[] }
export interface BoundaryRule {
  revision: number; expiresAt: number; blocked: ActionCapability[]; blockedDomains: string[]; allowedDomains: string[];
}
export interface OneTimeAllowance { id: string; capability: ActionCapability; expiresAt: number }
