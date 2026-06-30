import type { SuperHelperConfig } from '../config.js';
import { saveConfig } from '../config.js';
import { buildOnboardingConfig } from './config-commit.js';
import type { OnboardingDraft, OnboardingRun } from './types.js';

interface DraftReader {
  load(): OnboardingDraft | undefined;
}

interface RunReader {
  list(): OnboardingRun[];
}

export interface OnboardingCompletionRecoveryResult {
  config: SuperHelperConfig;
  recovered: boolean;
  reason?: string;
  runId?: string;
}

export function recoverOnboardingConfigFromCompletedRun(input: {
  config: SuperHelperConfig;
  drafts: DraftReader;
  runs: RunReader;
  path?: string;
  persist?: boolean;
}): OnboardingCompletionRecoveryResult {
  if (input.config.onboarding.completedAt) {
    return { config: input.config, recovered: false, reason: 'already_completed' };
  }

  const run = input.runs.list().find((item) => item.status === 'completed' && (item.completedAt || item.updatedAt));
  if (!run) {
    return { config: input.config, recovered: false, reason: 'no_completed_run' };
  }

  const draft = input.drafts.load();
  if (!draft) {
    return { config: input.config, recovered: false, reason: 'missing_draft', runId: run.id };
  }

  const completedAt = run.completedAt ?? run.updatedAt;
  if (!draftWasValidatedByRun(draft, completedAt)) {
    return { config: input.config, recovered: false, reason: 'draft_newer_than_run', runId: run.id };
  }

  const config = buildOnboardingConfig({
    draft,
    currentConfig: input.config,
    runId: run.id,
    completedAt,
  });
  if (input.persist) {
    saveConfig(config, input.path);
  }
  return { config, recovered: true, runId: run.id };
}

function draftWasValidatedByRun(draft: OnboardingDraft, completedAt: string): boolean {
  const draftTime = Date.parse(draft.updatedAt);
  const completedTime = Date.parse(completedAt);
  if (Number.isFinite(draftTime) && Number.isFinite(completedTime)) {
    return draftTime <= completedTime;
  }
  return draft.updatedAt <= completedAt;
}
