import { describe, expect, it, vi } from 'vitest';
import { EmergencyController, type EmergencyPort } from '../src/background/emergency';
import { unknownStatus } from '../src/background/monitor';

function setup() {
  let saved: unknown;
  const port: EmergencyPort = {
    read: async () => saved, write: vi.fn(async value => { saved = structuredClone(value); }),
    assessments: () => [1, 2].map(tabId => ({ ...unknownStatus(tabId, 'example.com', '', 1000), status: 'AUTOMATION_LIKELY' })),
    act: vi.fn(async tab => { if (tab.tabId === 2) throw new Error('cannot stop'); }), revokeGrants: vi.fn(async () => undefined),
  };
  return { port, controller: new EmergencyController(port, () => 2000) };
}
describe('emergency latch', () => {
  it('persists before action, revokes grants and records real per-tab outcomes without claiming to kill a controller', async () => {
    const { port, controller } = setup();
    const state = await controller.activate('quarantine');
    expect(port.revokeGrants).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ active: true, outcomes: [{ tabId: 1, result: 'confirmed' }, { tabId: 2, result: 'failed' }] });
    const restored = new EmergencyController(port, () => 2000); await restored.load();
    expect(restored.snapshot()).toMatchObject({ active: true, outcomes: [{ tabId: 1, result: 'confirmed' }, { tabId: 2, result: 'failed' }] });
    expect(port.act).toHaveBeenCalledTimes(2);
    await restored.reset();
    expect(restored.snapshot().active).toBe(false);
  });
  it('does not act if latch persistence fails, and serializes a racing reset', async () => {
    const { port, controller } = setup();
    vi.mocked(port.write).mockRejectedValueOnce(new Error('storage failed'));
    await expect(controller.activate('close')).rejects.toThrow();
    expect(port.act).not.toHaveBeenCalled();
    await Promise.all([controller.activate('close'), controller.reset()]);
    expect(controller.snapshot().active).toBe(false);
  });
  it('never acts on expired, unmonitored or unknown-domain observations', async () => {
    const { port, controller } = setup();
    port.assessments = () => [unknownStatus(1, 'example.com', '', 1000),
      { ...unknownStatus(2, 'example.com', '', 0), status: 'AUTOMATION_LIKELY', expiresAt: 1000 },
      { ...unknownStatus(3, null, '', 1000), status: 'AUTOMATION_LIKELY' }];
    await controller.activate('close');
    expect(port.act).not.toHaveBeenCalled();
  });
  it('attempts every tab even if revocation or an outcome write fails', async () => {
    const { port, controller } = setup();
    vi.mocked(port.revokeGrants).mockRejectedValue(new Error('cannot clean up'));
    vi.mocked(port.write).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('cannot save outcome'));
    await expect(controller.activate('quarantine')).rejects.toThrow();
    expect(port.act).toHaveBeenCalledTimes(2);
    expect(controller.snapshot()).toMatchObject({ active: true, grantsRevoked: false, outcomes: [{ tabId: 1, result: 'confirmed' }, { tabId: 2, result: 'failed' }] });
  });
});
