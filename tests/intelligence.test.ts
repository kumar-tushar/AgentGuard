import { describe, expect, it } from 'vitest';
import { attributeActivity, CONTROL_STATES, emptyActivity, hasAutomation, mayEnforce, unknownIdentity, type AgentSession } from '../src/shared/intelligence';

describe('intelligence contracts and conservative action attribution', () => {
  it('separates no observation from unmonitored without human or safe labels', () => {
    expect(CONTROL_STATES).toEqual(['AGENT_ACTIVE', 'AGENT_CONNECTED', 'AUTOMATION_LIKELY', 'AUTOMATION_SUSPECTED', 'NO_AUTOMATION_OBSERVED', 'UNMONITORED']);
    expect(hasAutomation('NO_AUTOMATION_OBSERVED')).toBe(false);
    expect(hasAutomation('UNMONITORED')).toBe(false);
    expect(hasAutomation('AUTOMATION_SUSPECTED')).toBe(true);
  });
  it('never attributes an unrelated or origin-unknown download to the only automated tab', () => {
    const sessions = [{ id: 'session-1', tabId: 1, endedAt: null }] as AgentSession[];
    expect(attributeActivity(4, sessions)).toEqual({ state: 'UNKNOWN' });
    expect(attributeActivity(undefined, sessions)).toEqual({ state: 'UNKNOWN' });
    expect(mayEnforce(attributeActivity(4, sessions))).toBe(false);
    expect(mayEnforce(attributeActivity(undefined, sessions))).toBe(false);
    expect(attributeActivity(1, sessions)).toEqual({ state: 'PROBABLE', sessionId: 'session-1', confidence: 0.5 });
    expect(mayEnforce(attributeActivity(1, sessions))).toBe(false);
  });
  it('does not manufacture certainty from ambiguous or ended sessions', () => {
    const sessions = [{ id: 'ended', tabId: 1, endedAt: 100 }] as AgentSession[];
    expect(attributeActivity(1, sessions)).toEqual({ state: 'UNKNOWN' });
    const ambiguous = [{ id: 'one', tabId: 1, endedAt: null }, { id: 'two', tabId: 1, endedAt: null }] as AgentSession[];
    expect(attributeActivity(1, ambiguous)).toEqual({ state: 'UNKNOWN' });
  });
  it('enforces only certain attribution unless coarse policy is explicitly selected', () => {
    expect(mayEnforce({ state: 'CERTAIN', sessionId: 'trusted' })).toBe(true);
    expect(mayEnforce({ state: 'UNKNOWN' }, true)).toBe(true);
    expect(mayEnforce({ state: 'UNKNOWN' })).toBe(false);
  });
  it('creates independent privacy-safe defaults without a controller claim', () => {
    const first = unknownIdentity();
    first.evidenceIds.push('test');
    expect(unknownIdentity()).toEqual({ displayName: null, vendor: null, product: null, version: null, attributionLevel: 'UNATTRIBUTED', confidence: 0, evidenceIds: [] });
    expect(Object.values(emptyActivity())).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
