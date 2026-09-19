import { describe, expect, it } from 'vitest';
import { isTrustedUi, parseRequest } from '../src/background/messages';
import { localPreferencesForSave } from '../src/background/settings';
import { DEFAULT_CONFIG, resolveConfig } from '../src/enterprise/config';
import { createManifest } from '../src/manifest';

describe('privileged message boundary', () => {
  it('accepts only packaged extension UI senders, not a page or content script', () => {
    expect(isTrustedUi({ id: 'ours', url: 'chrome-extension://ours/popup.html', frameId: 0 }, 'ours')).toBe(true);
    for (const sender of [
      { id: 'ours', url: 'https://example.com/' },
      { id: 'theirs', url: 'chrome-extension://ours/popup.html' },
      { id: 'ours', url: 'chrome-extension://ours/popup.html', frameId: 1 },
      { id: 'ours', url: 'chrome-extension://ours/arbitrary.html' },
      { id: 'ours' },
    ]) expect(isTrustedUi(sender, 'ours')).toBe(false);
  });
  it('rejects unknown, oversized, malformed or confused-deputy commands', () => {
    for (const input of [null, [], { type: 'UNMONITORED' }, { type: 'SCAN_TAB', tabId: -1 },
      { type: 'SCAN_TAB', tabId: NaN }, { type: 'SCAN_TAB', tabId: 1.2 },
      { type: 'QUARANTINE_TAB', tabId: 4, url: 'https://forged.example' },
      { type: 'SAVE_CONFIG', config: { ...DEFAULT_CONFIG, minimumConfidence: 0 } },
    ]) expect(() => parseRequest(input)).toThrow();
    expect(parseRequest({ type: 'QUARANTINE_TAB', tabId: 1 })).toEqual({ type: 'QUARANTINE_TAB', tabId: 1 });
    expect(() => parseRequest({ type: 'SCAN_TAB', tabId: 1 })).toThrow();
    expect(parseRequest({ type: 'QUARANTINE_TAB', tabId: 2_147_483_647 })).toEqual({ type: 'QUARANTINE_TAB', tabId: 2_147_483_647 });
    expect(() => parseRequest({ type: 'QUARANTINE_TAB', tabId: 2_147_483_648 })).toThrow();
  });
});

describe('managed settings persistence', () => {
  it('retains underlying local preferences when saving effective managed values', () => {
    const local = { ...DEFAULT_CONFIG, policyMode: 'warn' as const };
    const effective = resolveConfig(local, { policyMode: 'block' });
    const saved = localPreferencesForSave({ ...effective.values, retentionDays: 10 }, local, effective);
    expect(saved.policyMode).toBe('warn');
    expect(saved.retentionDays).toBe(10);
    expect(resolveConfig(saved, {}).values.policyMode).toBe('warn');
    expect(() => localPreferencesForSave({ ...effective.values, policyMode: 'monitor' }, local, effective)).toThrow();
  });
  it('locks session retention without overwriting underlying local history preferences', () => {
    const local = { ...DEFAULT_CONFIG, maxHistorySessions: 20, sessionRetentionDays: 3 };
    const effective = resolveConfig(local, { maxHistorySessions: 0, sessionRetentionDays: 1 });
    expect(() => localPreferencesForSave({ ...effective.values, maxHistorySessions: 50 }, local, effective)).toThrow();
    const saved = localPreferencesForSave(effective.values, local, effective);
    expect(saved).toMatchObject({ maxHistorySessions: 20, sessionRetentionDays: 3 });
  });
});

describe('single extension manifest', () => {
  it('declares only automatic monitoring APIs and HTTP(S) sites, with optional containment', () => {
    const manifest = createManifest();
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('AgentGuard');
    expect(manifest.permissions).toEqual(['storage', 'scripting', 'alarms', 'debugger', 'webNavigation']);
    expect(manifest.optional_permissions).toEqual(['declarativeNetRequestWithHostAccess']);
    expect(manifest.host_permissions).toEqual(['https://*/*', 'http://*/*']);
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toEqual([{ matches: ['https://*/*', 'http://*/*'], js: ['sensor.js'], run_at: 'document_start', world: 'ISOLATED', all_frames: false }]);
    expect(manifest.externally_connectable).toBeUndefined();
    expect(manifest.content_security_policy).toEqual(expect.objectContaining({ extension_pages: expect.not.stringContaining('unsafe-eval') }));
    expect(manifest.storage).toEqual({ managed_schema: 'managed-schema.json' });
  });
});
