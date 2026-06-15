import { join } from 'node:path';

export function onboardingRoot(rootDir: string): string {
  return join(rootDir, 'onboarding');
}

export function onboardingDraftPath(rootDir: string): string {
  return join(onboardingRoot(rootDir), 'draft.json');
}

export function onboardingRunsRoot(rootDir: string): string {
  return join(onboardingRoot(rootDir), 'runs');
}

export function onboardingRunPath(rootDir: string, runId: string): string {
  return join(onboardingRunsRoot(rootDir), `${runId}.json`);
}
