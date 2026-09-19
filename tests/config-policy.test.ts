import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig, validateConfig } from '../src/enterprise/config';
import { evaluatePolicy } from '../src/policy/evaluate';
import { domainFromUrl, matchesDomain, normalizeDomain } from '../src/shared/domains';

describe('canonical domains', () => {
  it('extracts only HTTP(S) hostnames and drops all URL secrets', () => {
    expect(domainFromUrl('https://user:password@EXAMPLE.com/path?token=secret#fragment')).toBe('example.com');
    expect(domainFromUrl('chrome://settings')).toBeNull();
    expect(domainFromUrl('file:///tmp/private')).toBeNull();
    expect(domainFromUrl('not a url')).toBeNull();
  });

  it('normalizes policy wildcards but rejects URLs, ports and malformed labels', () => {
    expect(normalizeDomain('*.EXAMPLE.COM.')).toBe('example.com');
    for (const invalid of ['https://example.com', 'example.com/path', 'example.com:443',
      'foo.*.example.com', 'a..example.com', '-bad.example.com', 'example.com?token=secret']) {
      expect(() => normalizeDomain(invalid)).toThrow();
    }
  });

  it('matches only exact and label-bounded subdomains', () => {
    expect(matchesDomain('EXAMPLE.com', 'example.com')).toBe(true);
    expect(matchesDomain('a.b.example.com', '*.example.com')).toBe(true);
    expect(matchesDomain('notexample.com', 'example.com')).toBe(false);
    expect(matchesDomain('example.com.evil.test', 'example.com')).toBe(false);
  });
});

describe('configuration', () => {
  it('normalizes valid settings and rejects unknown or out-of-bounds fields', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, sensitiveDomains: ['*.EXAMPLE.com'] }).sensitiveDomains)
      .toEqual(['example.com']);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, typo: true })).toThrow(/Unknown/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, minimumConfidence: Number.NaN })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, retentionDays: 0 })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, maxAuditEvents: 99 })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, sensitiveDomains: Array(101).fill('example.com') })).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, sensitiveDomains: ['example.com', '*.example.com'] }))
      .toThrow(/duplicate/);
  });

  it('allows partial managed overrides and reports exactly the locked keys', () => {
    const local = { ...DEFAULT_CONFIG, policyMode: 'warn' as const, sensitiveDomains: ['local.test'] };
    const result = resolveConfig(local, { policyMode: 'block', sensitiveDomains: ['*.SENSITIVE.test'] });
    expect(result.errors).toEqual([]);
    expect(result.values.policyMode).toBe('block');
    expect(result.values.sensitiveDomains).toEqual(['sensitive.test']);
    expect(result.values.retentionDays).toBe(DEFAULT_CONFIG.retentionDays);
    expect(result.managedKeys).toEqual(['policyMode', 'sensitiveDomains']);
  });

  it('migrates old preferences and validates bounded managed session retention', () => {
    const { sessionRetentionDays: _days, maxHistorySessions: _count, ...legacy } = DEFAULT_CONFIG;
    expect(validateConfig(legacy)).toMatchObject({ sessionRetentionDays: 7, maxHistorySessions: 50 });
    expect(resolveConfig(legacy, { sessionRetentionDays: 1, maxHistorySessions: 0 })).toMatchObject({
      values: { sessionRetentionDays: 1, maxHistorySessions: 0 },
      managedKeys: ['sessionRetentionDays', 'maxHistorySessions'], errors: [],
    });
    for (const invalid of [null, -1, 1.5, 501, NaN]) {
      expect(() => validateConfig({ ...DEFAULT_CONFIG, maxHistorySessions: invalid })).toThrow();
    }
    for (const invalid of [null, 0, 1.5, 91, NaN]) {
      expect(resolveConfig(DEFAULT_CONFIG, { sessionRetentionDays: invalid }).values.monitoringEnabled).toBe(false);
    }
  });

  it('freezes automatic enforcement and exposes invalid managed policy', () => {
    const result = resolveConfig({ ...DEFAULT_CONFIG, policyMode: 'block' },
      { policyMode: 'block', sensitiveDomains: ['example.com/path'] });
    expect(result.errors.join(' ')).toMatch(/Managed configuration/);
    expect(result.values.monitoringEnabled).toBe(false);
    expect(result.values.policyMode).toBe('monitor');
  });
});

describe('policy', () => {
  const config = { ...DEFAULT_CONFIG, policyMode: 'block' as const,
    sensitiveDomains: ['example.com'], minimumConfidence: 0.8 };

  it('quarantines only positive, threshold-meeting evidence on a matching host', () => {
    expect(evaluatePolicy({ domain: 'sub.example.com', status: 'AUTOMATION_LIKELY', confidence: 0.8 }, config))
      .toMatchObject({ action: 'quarantine', matchedDomain: 'example.com' });
    expect(evaluatePolicy({ domain: 'notexample.com', status: 'AUTOMATION_LIKELY', confidence: 1 }, config).action).toBe('none');
    expect(evaluatePolicy({ domain: 'example.com', status: 'UNMONITORED', confidence: 1 }, config).action).toBe('none');
    expect(evaluatePolicy({ domain: 'example.com', status: 'AUTOMATION_SUSPECTED', confidence: 0.79 }, config).action)
      .toBe('none');
    expect(evaluatePolicy({ domain: 'example.com', status: 'AUTOMATION_LIKELY', confidence: Number.NaN }, config).action)
      .toBe('none');
  });

  it('separates monitor and warn decisions from containment', () => {
    const tab = { domain: 'example.com', status: 'AUTOMATION_SUSPECTED' as const, confidence: 0.9 };
    expect(evaluatePolicy(tab, { ...config, policyMode: 'monitor' }).action).toBe('monitor');
    expect(evaluatePolicy(tab, { ...config, policyMode: 'warn' }).action).toBe('warn');
    expect(evaluatePolicy(tab, { ...config, monitoringEnabled: false }).action).toBe('none');
  });
});
