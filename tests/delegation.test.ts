import { describe, expect, it } from 'vitest';
import { ControlStore } from '../src/delegation/store';

function setup() {
  let value: unknown, now = 1000;
  const port = { read: async () => value, write: async (data: unknown) => { value = structuredClone(data); } };
  return { port, store: new ControlStore(port, () => now), advance: (ms: number) => { now += ms; } };
}
describe('delegation and owner pauses', () => {
  it('restricts presets, sites and times with deny precedence and managed override disablement', async () => {
    const { store, advance } = setup();
    await store.grant(1, 'READ_ONLY', [], [], 15, 60);
    expect(store.rule(1, 'example.com', true).blocked).toContain('click');
    expect(store.rule(1, 'example.com', true).blocked).not.toContain('navigate');
    expect(store.rule(1, 'example.com', false).blocked).toEqual([]);
    await store.grant(1, 'LIMITED', ['example.com'], ['secret.example.com'], 15, 60);
    expect(store.rule(1, 'example.com', true).blocked).not.toContain('click');
    expect(store.rule(1, 'secret.example.com', true).blocked).toContain('click');
    expect(store.rule(1, 'notexample.com', true).blocked).toContain('click');
    advance(15 * 60_000);
    expect(store.snapshot().grants).toEqual([]);
    await expect(store.grant(1, 'FULL_ACCESS', [], [], 61, 60)).rejects.toThrow();
    await expect(store.grant(1, 'LIMITED', [], [], 15, 60)).rejects.toThrow();
  });
  it('pauses only the requested site, resumes explicitly, and emergency revokes every allowance', async () => {
    const { store } = setup();
    await store.grant(1, 'READ_ONLY', [], [], 60, 60);
    const view = await store.pause('example.com', 15);
    expect(store.rule(1, 'example.com', true).blocked).toEqual([]);
    expect(store.rule(1, 'other.example', true).blocked).toContain('click');
    await store.resume(view.pauses[0]!.id);
    expect(store.rule(1, 'example.com', true).blocked).toContain('click');
    await store.revokeAll();
    expect(store.snapshot()).toMatchObject({ grants: [], pauses: [] });
  });
  it('restores live grants across worker restart without rebinding absent tabs', async () => {
    const { store, port } = setup();
    await store.grant(1, 'FULL_ACCESS', [], [], 15, 60);
    const restored = new ControlStore(port, () => 2000);
    await restored.load(new Set([1])); expect(restored.snapshot().grants).toHaveLength(1);
    const absent = new ControlStore(port, () => 2000);
    await absent.load(new Set([2])); expect(absent.snapshot().grants).toHaveLength(0);
  });
  it('shortens already-issued grants when organization duration limits become stricter', async () => {
    const { port } = setup(); let maximum = 60, now = 1000;
    const store = new ControlStore(port, () => now, () => maximum);
    await store.grant(1, 'READ_ONLY', [], [], 60, 60);
    maximum = 5; await store.reconcileLimits(); expect(store.snapshot().grants[0]?.expiresAt).toBe(301_000);
    now = 301_001; expect(store.snapshot().grants).toEqual([]);
    expect(store.rule(1, 'example.com', true).blocked).toEqual([]);
    maximum = 60; expect(store.snapshot().grants).toEqual([]);
  });
});
