import type { Detector } from '../shared/contracts';

/** Passive observation only. The Chrome adapter must never attach to a tab. */
export const debuggerDetector: Detector = {
  id: 'debugger',
  family: 'debugger',
  detect(context) {
    if (context.debuggerAttached === null) {
      return { evidence: [], coverage: { detector: 'debugger', availability: 'unavailable', reason: context.debuggerReason || 'Reduced coverage: debugger inspection unavailable or not permitted' } };
    }
    return {
      evidence: context.debuggerAttached ? [{
        detector: 'debugger',
        family: 'debugger',
        confidence: 0.38,
        description: 'A debugger is attached to this tab; ordinary DevTools can also cause this signal.',
        metadata: { signal: 'automation-indicator', attached: true },
        observedAt: context.now,
        expiresAt: context.now + 90_000,
      }] : [],
      coverage: { detector: 'debugger', availability: 'available', reason: 'Debugger target attachment checked' },
    };
  },
};
