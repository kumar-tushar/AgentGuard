import { describe, expect, it, vi } from 'vitest';
import { UpdateController } from '../src/background/updates';

describe('staged updates', () => {
  it('defers active-control reload, retains the pending version and applies once idle', async () => {
    let busy = true, saved: unknown;
    const port = { read: async () => saved, write: vi.fn(async value => { saved = value; }), busy: () => busy, reload: vi.fn() };
    const store = new UpdateController(port, () => 1000);
    await store.stage('0.2.0');
    expect(port.reload).not.toHaveBeenCalled();
    const restored = new UpdateController(port, () => 1000); await restored.load();
    expect(restored.snapshot()?.version).toBe('0.2.0');
    busy = false; expect(await restored.apply()).toBe(true);
    expect(await restored.apply()).toBe(false); expect(port.reload).toHaveBeenCalledOnce();
  });
  it('requires a valid version and successful state write before requesting reload', async () => {
    const port = { read: async () => null, write: vi.fn(async () => undefined), busy: () => true, reload: vi.fn() };
    const store = new UpdateController(port);
    await expect(store.stage('https://attacker.example')).rejects.toThrow();
    await store.stage('0.2.0');
    port.write.mockRejectedValueOnce(new Error('cannot persist'));
    await expect(store.apply(true)).rejects.toThrow();
    expect(port.reload).not.toHaveBeenCalled();
  });
});
