import type { AgentGuardConfig, EffectiveConfig } from '../shared/contracts';
import { normalizeDomain } from '../shared/domains';
import { integrationEndpoint } from '../integrations/client';

const CONFIG_KEYS = [
  'schemaVersion', 'monitoringEnabled', 'behaviorEnabled', 'policyMode',
  'sensitiveDomains', 'minimumConfidence', 'retentionDays', 'maxAuditEvents', 'sessionRetentionDays', 'maxHistorySessions',
  'employeeControlsAllowed', 'maximumGrantMinutes',
  'observationAllowed', 'downloadPolicy', 'desktopNotifications', 'stackSignalsEnabled',
  'trustLookupEnabled', 'trustEndpoint', 'trustProvider', 'siteDeclarationsEnabled', 'contributionsEnabled', 'contributionEndpoint',
] as const satisfies readonly (keyof AgentGuardConfig)[];

export const DEFAULT_CONFIG: AgentGuardConfig = Object.freeze({
  schemaVersion: 1,
  monitoringEnabled: true,
  behaviorEnabled: true,
  policyMode: 'monitor',
  sensitiveDomains: Object.freeze([]) as unknown as string[],
  minimumConfidence: 0.75,
  retentionDays: 30,
  maxAuditEvents: 1000,
  sessionRetentionDays: 7,
  maxHistorySessions: 50,
  employeeControlsAllowed: true,
  maximumGrantMinutes: 60,
  observationAllowed: true,
  downloadPolicy: 'off',
  desktopNotifications: false,
  stackSignalsEnabled: false,
  trustLookupEnabled: false, trustEndpoint: null, trustProvider: 'registry',
  siteDeclarationsEnabled: false, contributionsEnabled: false, contributionEndpoint: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateConfig(input: unknown): AgentGuardConfig {
  if (!isRecord(input)) throw new Error('Configuration must be an object');
  const unknownKey = Object.keys(input).find((key) => !CONFIG_KEYS.includes(key as keyof AgentGuardConfig));
  if (unknownKey) throw new Error(`Unknown configuration field: ${unknownKey}`);
  if (input.schemaVersion !== 1) throw new Error('Unsupported configuration schemaVersion');
  if (typeof input.monitoringEnabled !== 'boolean') throw new Error('monitoringEnabled must be boolean');
  if (typeof input.behaviorEnabled !== 'boolean') throw new Error('behaviorEnabled must be boolean');
  if (input.policyMode !== 'monitor' && input.policyMode !== 'warn' && input.policyMode !== 'block') {
    throw new Error('policyMode must be monitor, warn or block');
  }
  if (!Array.isArray(input.sensitiveDomains) || input.sensitiveDomains.length > 100 ||
      input.sensitiveDomains.some((domain) => typeof domain !== 'string')) {
    throw new Error('sensitiveDomains must be an array of at most 100 hostnames');
  }
  const sensitiveDomains = input.sensitiveDomains.map((domain: string) => normalizeDomain(domain));
  if (new Set(sensitiveDomains).size !== sensitiveDomains.length) {
    throw new Error('sensitiveDomains contains duplicate hostnames');
  }
  if (typeof input.minimumConfidence !== 'number' || !Number.isFinite(input.minimumConfidence) ||
      input.minimumConfidence < 0.1 || input.minimumConfidence > 1) {
    throw new Error('minimumConfidence must be a finite number from 0.1 to 1');
  }
  if (!Number.isInteger(input.retentionDays) || (input.retentionDays as number) < 1 ||
      (input.retentionDays as number) > 90) {
    throw new Error('retentionDays must be an integer from 1 to 90');
  }
  if (!Number.isInteger(input.maxAuditEvents) || (input.maxAuditEvents as number) < 100 ||
      (input.maxAuditEvents as number) > 5000) {
    throw new Error('maxAuditEvents must be an integer from 100 to 5000');
  }
  // Additive schema-v1 migration: existing saved preferences acquire bounded defaults.
  const sessionRetentionDays = input.sessionRetentionDays === undefined ? 7 : input.sessionRetentionDays;
  const maxHistorySessions = input.maxHistorySessions === undefined ? 50 : input.maxHistorySessions;
  const employeeControlsAllowed = input.employeeControlsAllowed === undefined ? true : input.employeeControlsAllowed;
  const maximumGrantMinutes = input.maximumGrantMinutes === undefined ? 60 : input.maximumGrantMinutes;
  const observationAllowed = input.observationAllowed === undefined ? true : input.observationAllowed;
  const downloadPolicy = input.downloadPolicy === undefined ? 'off' : input.downloadPolicy;
  const desktopNotifications = input.desktopNotifications === undefined ? false : input.desktopNotifications;
  const stackSignalsEnabled = input.stackSignalsEnabled === undefined ? false : input.stackSignalsEnabled;
  if (typeof stackSignalsEnabled !== 'boolean') throw new Error('stackSignalsEnabled must be boolean');
  const trustLookupEnabled = input.trustLookupEnabled === undefined ? false : input.trustLookupEnabled;
  const siteDeclarationsEnabled = input.siteDeclarationsEnabled === undefined ? false : input.siteDeclarationsEnabled;
  const contributionsEnabled = input.contributionsEnabled === undefined ? false : input.contributionsEnabled;
  if ([trustLookupEnabled, siteDeclarationsEnabled, contributionsEnabled].some(value => typeof value !== 'boolean')) throw new Error('Integration enablement must be boolean');
  const trustEndpoint = integrationEndpoint(input.trustEndpoint), contributionEndpoint = integrationEndpoint(input.contributionEndpoint);
  const trustProvider = input.trustProvider === undefined ? 'registry' : input.trustProvider;
  if (trustProvider !== 'aim' && trustProvider !== 'registry') throw new Error('Invalid trust provider');
  if (trustLookupEnabled && !trustEndpoint || contributionsEnabled && !contributionEndpoint) throw new Error('Enabled integration requires an approved HTTPS endpoint');
  if (typeof desktopNotifications !== 'boolean') throw new Error('desktopNotifications must be boolean');
  if (typeof observationAllowed !== 'boolean' || (downloadPolicy !== 'off' && downloadPolicy !== 'observe' && downloadPolicy !== 'block_all')) throw new Error('Invalid optional observation settings');
  if (typeof employeeControlsAllowed !== 'boolean' || !Number.isInteger(maximumGrantMinutes) || (maximumGrantMinutes as number) < 1 || (maximumGrantMinutes as number) > 60) throw new Error('Invalid user control limits');
  if (!Number.isInteger(sessionRetentionDays) || (sessionRetentionDays as number) < 1 || (sessionRetentionDays as number) > 90) {
    throw new Error('sessionRetentionDays must be an integer from 1 to 90');
  }
  if (!Number.isInteger(maxHistorySessions) || (maxHistorySessions as number) < 0 || (maxHistorySessions as number) > 500) {
    throw new Error('maxHistorySessions must be an integer from 0 to 500');
  }
  return {
    schemaVersion: 1,
    monitoringEnabled: input.monitoringEnabled,
    behaviorEnabled: input.behaviorEnabled,
    policyMode: input.policyMode,
    sensitiveDomains,
    minimumConfidence: input.minimumConfidence,
    retentionDays: input.retentionDays as number,
    maxAuditEvents: input.maxAuditEvents as number,
    sessionRetentionDays: sessionRetentionDays as number,
    maxHistorySessions: maxHistorySessions as number,
    employeeControlsAllowed,
    maximumGrantMinutes: maximumGrantMinutes as number,
    observationAllowed,
    downloadPolicy: downloadPolicy as AgentGuardConfig['downloadPolicy'],
    desktopNotifications,
    stackSignalsEnabled,
    trustLookupEnabled: trustLookupEnabled as boolean, trustEndpoint, trustProvider,
    siteDeclarationsEnabled: siteDeclarationsEnabled as boolean, contributionsEnabled: contributionsEnabled as boolean, contributionEndpoint,
  };
}

/** Managed fields override local fields. Any invalid input freezes automatic enforcement. */
export function resolveConfig(local: unknown, managed: unknown): EffectiveConfig {
  const errors: string[] = [];
  let base: AgentGuardConfig = DEFAULT_CONFIG;
  if (local !== undefined && local !== null) {
    try {
      base = validateConfig(local);
    } catch (error) {
      errors.push(`Local configuration: ${String(error instanceof Error ? error.message : error)}`);
    }
  }
  const managedKeys: (keyof AgentGuardConfig)[] = [];
  if (managed !== undefined && managed !== null) {
    if (!isRecord(managed)) {
      errors.push('Managed configuration must be an object');
    } else {
      managedKeys.push(...CONFIG_KEYS.filter((key) => Object.hasOwn(managed, key)));
      try {
        base = validateConfig({ ...base, ...managed });
      } catch (error) {
        errors.push(`Managed configuration: ${String(error instanceof Error ? error.message : error)}`);
      }
    }
  }
  if (errors.length > 0) {
    base = { ...base, monitoringEnabled: false, policyMode: 'monitor' };
  }
  return { values: base, managedKeys, errors };
}
