import { describe, expect, it } from 'vitest';
import { SessionStore, type SessionData } from '../src/background/session';
import type { QuarantineRecord, TabAgentStatus } from '../src/shared/contracts';
import { assess } from '../src/detection/engine';

function status(tabId: number): TabAgentStatus {
  return {
    tabId, domain: 'example.com', status: 'UNMONITORED', identifiedAgent: null, frameworkHints: [],
    confidence: 0, evidence: [], coverage: [], firstDetectedAt: null, lastDetectedAt: null,
    assessedAt: 100, expiresAt: 200,
    policy: { action: 'none', reason: 'No observation', matchedDomain: null },
  };
}

function quarantine(tabId: number): QuarantineRecord {
  return { tabId, domain: 'example.com', createdAt: 100, reason: 'Employee requested quarantine', networkBlocked: false };
}

describe('SessionStore', () => {
  it('loads only live, well-formed tab and quarantine entries', async () => {
    const store = new SessionStore({
      async read() {
        return {
          tabs: { 1: status(1), 2: null, 3: status(9), 4: { ...status(4), domain: 'example.com/path' }, 5: status(5) },
          quarantines: { 1: quarantine(1), 2: null, 3: quarantine(9), 4: { ...quarantine(4), reason: 7 } },
        };
      },
      async write() { throw new Error('not used'); },
    });
    await store.load(new Set([1, 2, 3, 4]));
    expect([...store.tabs.keys()]).toEqual([1]);
    expect([...store.quarantines.keys()]).toEqual([1]);
  });

  it('tolerates corrupt top-level maps and null values', async () => {
    const store = new SessionStore({ async read() { return { tabs: [null], quarantines: { 1: null } }; },
      async write() { throw new Error('not used'); } });
    await expect(store.load(new Set([1]))).resolves.toBeUndefined();
    expect(store.tabs.size).toBe(0);
    expect(store.quarantines.size).toBe(0);
  });

  it('validates nested evidence and coverage, chronology, and evidence-backed labels', async () => {
    const assessment = await assess({ now: 100, runtime: { webdriver: true, fingerprints: ['playwright-binding'] },
      behavior: null, debuggerAttached: true, runtimeReason: 'Runtime checked', debuggerReason: 'Attachment checked' });
    const detected: TabAgentStatus = { ...status(1), ...assessment, firstDetectedAt: 100, lastDetectedAt: 100 };
    const invalid = [
      { evidence: [{}] },
      { coverage: [{}] },
      { confidence: Number.NaN },
      { status: 'NO_AUTOMATION_OBSERVED', confidence: 1 },
      { evidence: [] },
      { coverage: [] },
      { identifiedAgent: 'Unverified agent' },
      { frameworkHints: ['Verified Playwright'] },
      { firstDetectedAt: null },
      { firstDetectedAt: 101 },
      { lastDetectedAt: -1 },
      { lastDetectedAt: 101 },
      { assessedAt: -1 },
      { expiresAt: 100_000_000 },
      { evidence: [{ ...detected.evidence[0], metadata: { signal: 'automation-indicator', webdriver: true, token: 'secret' } }] },
      { evidence: [{ ...detected.evidence[0], metadata: { signal: 'trusted-activity' } }] },
      { evidence: [{ ...detected.evidence[0], family: 'debugger' }] },
      { evidence: [{ ...detected.evidence[0], expiresAt: 100_000_000 }] },
      { coverage: [...detected.coverage, detected.coverage[0]] },
      { policy: { action: 'quarantine', reason: 'Policy', matchedDomain: 'https://example.com/private' } },
      { url: 'https://example.com/private' },
    ];
    const tabs = Object.fromEntries([['1', detected], ...invalid.map((patch, index) => {
      const tabId = index + 2;
      return [String(tabId), { ...detected, ...patch, tabId }];
    })]);
    const store = new SessionStore({ async read() { return { tabs }; }, async write() {} });
    await store.load(new Set(Array.from({ length: invalid.length + 1 }, (_, index) => index + 1)));
    expect([...store.tabs.keys()]).toEqual([1]);
    expect(store.tabs.get(1)).toEqual(detected);
  });

  it('rejects older NO_AUTOMATION_OBSERVED snapshots without debugger coverage while preserving fully supported snapshots', async () => {
    const assessment = await assess({
      now: 100, runtime: { webdriver: false, fingerprints: [] }, debuggerAttached: false,
      runtimeReason: 'Runtime checked', debuggerReason: 'Attachment checked',
      behavior: { trustedEvents: 1, syntheticEvents: 0, intervalSamples: 0,
        meanIntervalMs: 0, intervalVariance: 0, lastTrustedAt: 100, startedAt: 100 },
    });
    expect(assessment.status).toBe('NO_AUTOMATION_OBSERVED');
    const supported: TabAgentStatus = { ...status(1), ...assessment };
    const legacy: TabAgentStatus = { ...supported, tabId: 2,
      coverage: supported.coverage.map(item => item.detector === 'debugger'
        ? { ...item, availability: 'unavailable', reason: 'Debugger unavailable' } : item),
    };
    const store = new SessionStore({ async read() { return { tabs: { 1: supported, 2: legacy } }; }, async write() {} });
    await store.load(new Set([1, 2]));
    expect([...store.tabs.keys()]).toEqual([1]);
    expect(store.tabs.get(1)).toEqual(supported);
  });

  it('rejects negative quarantine timestamps and non-contract fields', async () => {
    const store = new SessionStore({ async read() { return { quarantines: {
      1: { ...quarantine(1), createdAt: -1 },
      2: { ...quarantine(2), url: 'https://example.com/private' },
      3: quarantine(3),
    } }; }, async write() {} });
    await store.load(new Set([1, 2, 3]));
    expect([...store.quarantines.keys()]).toEqual([3]);
  });

  it('replaces the loaded snapshot and does not retain mutable storage references', async () => {
    const raw = { tabs: { 1: status(1) }, quarantines: { 1: quarantine(1) } };
    const store = new SessionStore({ async read() { return raw; }, async write() {} });
    await store.load(new Set([1]));
    raw.tabs[1].policy.reason = 'changed';
    raw.quarantines[1].networkBlocked = true;
    expect(store.tabs.get(1)?.policy.reason).toBe('No observation');
    expect(store.quarantines.get(1)?.networkBlocked).toBe(false);
    await store.load(new Set());
    expect(store.tabs.size).toBe(0);
    expect(store.quarantines.size).toBe(0);
  });

  it('captures snapshots at enqueue time and serializes writes', async () => {
    const snapshots: SessionData[] = [];
    const store = new SessionStore({
      async read() { return undefined; },
      async write(data) { await Promise.resolve(); snapshots.push(data); },
    });
    store.tabs.set(1, status(1));
    const first = store.persist();
    store.tabs.delete(1);
    const second = store.persist();
    await Promise.all([first, second]);
    expect(Object.keys(snapshots[0]?.tabs ?? {})).toEqual(['1']);
    expect(Object.keys(snapshots[1]?.tabs ?? {})).toEqual([]);
  });

  it('reports a failed write without preventing newer snapshots from persisting', async () => {
    const snapshots: SessionData[] = [];
    let writes = 0;
    const store = new SessionStore({ async read() { return undefined; }, async write(data) {
      if (++writes === 1) throw new Error('storage temporarily failed');
      snapshots.push(data);
    } });
    store.tabs.set(1, status(1));
    await expect(store.persist()).rejects.toThrow(/storage/);
    store.tabs.delete(1);
    await store.persist();
    expect(snapshots).toEqual([{ tabs: {}, quarantines: {} }]);
  });
});
