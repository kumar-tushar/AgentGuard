import type { DetectionContext, DetectionEvidence, Detector, DetectorResult, Fingerprint } from '../shared/contracts';
import { behaviorDetector } from './behavior';
import { debuggerDetector } from './debugger';
import { fingerprintDetector } from './fingerprint';
import { scoreAssessment, type ScoredAssessment } from './scoring';
import { normalizeDetectionContext } from './validation';
import { webdriverDetector } from './webdriver';

const defaultDetectors: readonly Detector[] = [webdriverDetector, fingerprintDetector, debuggerDetector, behaviorDetector];
const markers: readonly Fingerprint[] = ['playwright-binding', 'playwright-init', 'selenium-global', 'webdriver-global'];

export type Assessment = ScoredAssessment;

export interface AssessmentOptions {
  detectors?: readonly Detector[];
  timeoutMs?: number;
}

function validEvidence(item: unknown, detector: Detector, now: number): item is DetectionEvidence {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const value = item as Record<string, unknown>;
  if (Object.keys(value).some(key => !['detector', 'family', 'confidence', 'description', 'metadata', 'observedAt', 'expiresAt'].includes(key))) return false;
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const fields = metadata as Record<string, unknown>;
  if (Object.keys(fields).some(key => !['signal', 'webdriver', 'attached', 'marker', 'bucket'].includes(key))) return false;
  if (fields.signal !== 'automation-indicator' && fields.signal !== 'trusted-activity') return false;
  if (fields.signal === 'trusted-activity' && detector.id !== 'behavior') return false;
  if (fields.webdriver !== undefined && fields.webdriver !== true) return false;
  if (fields.attached !== undefined && fields.attached !== true) return false;
  if (fields.marker !== undefined && !markers.includes(fields.marker as Fingerprint)) return false;
  if (fields.bucket !== undefined && !['synthetic-interactions', 'regular-timing'].includes(String(fields.bucket))) return false;
  return value.detector === detector.id && value.family === detector.family &&
    typeof value.description === 'string' && value.description.length <= 256 &&
    typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1 &&
    typeof value.observedAt === 'number' && Number.isFinite(value.observedAt) && value.observedAt <= now &&
    typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) && value.expiresAt > value.observedAt && value.expiresAt <= now + 90_000;
}

async function runDetector(detector: Detector, context: DetectionContext, timeoutMs: number): Promise<DetectorResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      Promise.resolve().then(() => detector.detect(context)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    if (!outcome || !outcome.coverage || outcome.coverage.detector !== detector.id ||
      !['available', 'unavailable', 'error'].includes(outcome.coverage.availability) ||
      !Array.isArray(outcome.evidence) || outcome.evidence.length > 8 ||
      outcome.evidence.some(item => !validEvidence(item, detector, context.now)) ||
      (outcome.coverage.availability !== 'available' && outcome.evidence.length > 0)) {
      throw new Error('invalid coverage');
    }
    return {
      evidence: outcome.evidence,
      coverage: { detector: detector.id, availability: outcome.coverage.availability, reason: String(outcome.coverage.reason).slice(0, 160) },
    };
  } catch {
    return { evidence: [], coverage: { detector: detector.id, availability: 'error', reason: 'Detector failed or timed out' } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A failed detector only reduces coverage; it never produces a clean bill of health. */
export async function assess(context: Readonly<DetectionContext>, options: AssessmentOptions = {}): Promise<Assessment> {
  const normalized = normalizeDetectionContext(context);
  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? Math.min(options.timeoutMs!, 10_000)
    : 500;
  const results = await Promise.all((options.detectors ?? defaultDetectors).map(detector => runDetector(detector, normalized, timeoutMs)));
  const evidence: DetectionEvidence[] = [];
  for (const result of results) {
    if (result.coverage.availability === 'available') evidence.push(...result.evidence);
  }
  return scoreAssessment(normalized, evidence, results.map(result => result.coverage));
}
