import type { Request, Response, ResponseData, TabState } from '../shared/contracts';

export async function send<T extends Request>(request: T): Promise<ResponseData[T['type']]> {
  const response = await chrome.runtime.sendMessage(request) as Response<ResponseData[T['type']]> | undefined;
  if (!response || typeof response.ok !== 'boolean') {
    throw new Error('AgentGuard did not return a valid response. Try again.');
  }
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export const stateCopy: Record<TabState, { label: string; detail: string }> = {
  NO_AUTOMATION_OBSERVED: {
    label: 'No automation observed',
    detail: 'No current positive automation evidence in available sensors. This does not prove human control or safety.',
  },
  AGENT_ACTIVE: {
    label: 'Automation active',
    detail: 'Strong correlated control evidence and recent associated activity. The controller may remain unknown.',
  },
  AGENT_CONNECTED: {
    label: 'Automation connected',
    detail: 'Strong control evidence persists; no recent associated activity was observed. The external controller may be idle.',
  },
  AUTOMATION_LIKELY: {
    label: 'Automation likely',
    detail: 'Strong evidence supports browser automation. Recent control activity and a specific AI product are not confirmed.',
  },
  AUTOMATION_SUSPECTED: {
    label: 'Automation suspected',
    detail: 'Some signals suggest automation, but the evidence is not conclusive.',
  },
  UNMONITORED: {
    label: 'Unmonitored',
    detail: 'AgentGuard cannot determine who controls this tab with current coverage.',
  },
};

export function scoreText(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)} / 100`;
}

export function timeText(timestamp: number | null): string {
  if (timestamp === null) return 'Not observed';
  return new Date(timestamp).toLocaleString();
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}
