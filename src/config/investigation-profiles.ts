export type InvestigationEffort = 'low' | 'medium' | 'high';
export class InvestigationProfilesError extends Error {
  constructor(message: string) { super(message); this.name = 'InvestigationProfilesError'; }
}
export interface InvestigationProfiles {
  enabled: boolean;
  fast: { model?: string; effort: InvestigationEffort; maxTurns: number };
  deep: { model?: string; effort: InvestigationEffort; timeoutMs: number };
}

export function validateInvestigationProfiles(value: unknown): InvestigationProfiles {
  const input = value as InvestigationProfiles;
  if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean') {
    throw new InvestigationProfilesError('investigationProfiles.enabled 必须为布尔值');
  }
  for (const name of ['fast', 'deep'] as const) {
    const profile = input[name];
    if (!profile || (profile.model !== undefined && typeof profile.model !== 'string') || !['low', 'medium', 'high'].includes(profile.effort)) {
      throw new InvestigationProfilesError(`investigationProfiles.${name} 需要有效 effort`);
    }
  }
  if (!Number.isSafeInteger(input.fast.maxTurns) || input.fast.maxTurns <= 0 ||
      !Number.isSafeInteger(input.deep.timeoutMs) || input.deep.timeoutMs <= 0) {
    throw new InvestigationProfilesError('investigationProfiles turns 和 timeout 必须为正整数');
  }
  return { enabled: input.enabled,
    fast: { ...(input.fast.model?.trim() ? { model: input.fast.model.trim() } : {}), effort: input.fast.effort, maxTurns: input.fast.maxTurns },
    deep: { ...(input.deep.model?.trim() ? { model: input.deep.model.trim() } : {}), effort: input.deep.effort, timeoutMs: input.deep.timeoutMs } };
}
