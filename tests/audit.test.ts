import { describe, expect, it, vi } from 'vitest';
import { AuditStore, type AuditStoragePort } from '../src/audit/store';
import type { AuditEvent } from '../src/shared/contracts';

function memoryPort(): AuditStoragePort & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    async get(key) { return values.get(key); },
    async set(key, value) { await Promise.resolve(); values.set(key, value); },
  };
}

function event(id: string, timestamp: number, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id, timestamp, tabId: 7, domain: 'example.com', eventType: 'detection_changed',
    detectedAgent: null, confidence: 0.7, policyAction: 'monitor', detail: 'ignored', ...overrides,
  };
}

describe('AuditStore', () => {
  const now = 1_800_000_000_000;

  it('serializes concurrent append calls without losing events', async () => {
    const port = memoryPort();
    const store = new AuditStore(port, () => ({ retentionDays: 30, maxAuditEvents: 100 }), () => now);
    await Promise.all(Array.from({ length: 80 }, (_, i) => store.append(event(`e${i}`, now))));
    expect((await store.list()).map((item) => item.id)).toEqual(Array.from({ length: 80 }, (_, i) => `e${i}`));
  });

  it('retains only bounded recent events and exports a versioned local envelope', async () => {
    const port = memoryPort();
    const store = new AuditStore(port, () => ({ retentionDays: 1, maxAuditEvents: 100 }), () => now);
    await store.append(event('old', now - 2 * 86_400_000));
    await Promise.all(Array.from({ length: 120 }, (_, i) => store.append(event(`recent${i}`, now))));
    const envelope = await store.export();
    expect(envelope).toMatchObject({ schemaVersion: 1, source: 'agentguard-extension', exportedAt: now });
    expect(envelope.events).toHaveLength(100);
    expect(envelope.events.at(-1)?.id).toBe('recent119');
    expect(envelope.events.some((item) => item.id === 'old')).toBe(false);
  });

  it('removes unsafe details and identity, and rejects URL leakage', async () => {
    const port = memoryPort();
    const store = new AuditStore(port, () => ({ retentionDays: 30, maxAuditEvents: 100 }), () => now);
    await store.append(event('safe', now, { detail: 'token=secret', detectedAgent: 'page-supplied agent' }));
    expect(await store.list()).toMatchObject([{
      detail: 'Tab automation assessment changed', detectedAgent: null, domain: 'example.com',
    }]);
    await expect(store.append(event('bad', now, { domain: 'https://example.com/?token=secret' }))).rejects.toThrow();
    await expect(store.append(event('wildcard', now, { domain: '*.example.com' }))).rejects.toThrow();
    expect(await store.list()).toHaveLength(1);
  });

  it('sanitizes persisted data and clears explicitly', async () => {
    const port = memoryPort();
    const store = new AuditStore(port, () => ({ retentionDays: 30, maxAuditEvents: 100 }), () => now);
    port.values.set('agentguard.audit.v1', [event('good', now), event('bad', now, { domain: 'example.com/path' })]);
    expect((await store.list()).map((item) => item.id)).toEqual(['good']);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('physically prunes retained storage during reads and export', async () => {
    const port = memoryPort();
    const store = new AuditStore(port, () => ({ retentionDays: 1, maxAuditEvents: 100 }), () => now);
    port.values.set('agentguard.audit.v1', [event('expired', now - 2 * 86_400_000), event('valid', now)]);
    expect((await store.list()).map((item) => item.id)).toEqual(['valid']);
    expect(port.values.get('agentguard.audit.v1')).toMatchObject([{ id: 'valid' }]);
    port.values.set('agentguard.audit.v1', [event('expired', now - 2 * 86_400_000), event('valid', now)]);
    expect((await store.export()).events).toHaveLength(1);
    expect(port.values.get('agentguard.audit.v1')).toMatchObject([{ id: 'valid' }]);
  });

  it('physically removes corrupt storage and avoids rewriting unchanged sanitized events', async () => {
    const port = memoryPort();
    const store = new AuditStore(port, () => ({ retentionDays: 1, maxAuditEvents: 100 }), () => now);
    port.values.set('agentguard.audit.v1', { invalid: 'payload' });
    expect(await store.list()).toEqual([]);
    expect(port.values.get('agentguard.audit.v1')).toEqual([]);
    await store.append(event('valid', now));
    const set = vi.spyOn(port, 'set');
    await store.list();
    await store.export();
    expect(set).not.toHaveBeenCalled();
  });

  it('reports failed retention cleanup and permits the next read to retry', async () => {
    const port = memoryPort();
    const store = new AuditStore(port, () => ({ retentionDays: 1, maxAuditEvents: 100 }), () => now);
    port.values.set('agentguard.audit.v1', [event('expired', now - 2 * 86_400_000)]);
    vi.spyOn(port, 'set').mockRejectedValueOnce(new Error('storage failed'));
    await expect(store.list()).rejects.toThrow(/storage/);
    expect(port.values.get('agentguard.audit.v1')).toHaveLength(1);
    expect(await store.list()).toEqual([]);
    expect(port.values.get('agentguard.audit.v1')).toEqual([]);
  });
});
