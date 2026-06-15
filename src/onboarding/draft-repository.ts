import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './atomic-json.js';
import { onboardingDraftPath } from './paths.js';
import type { OnboardingDraft } from './types.js';

export class FileOnboardingDraftRepository {
  readonly path: string;

  constructor(rootDir: string) {
    this.path = onboardingDraftPath(rootDir);
  }

  load(): OnboardingDraft | undefined {
    if (!existsSync(this.path)) {
      return undefined;
    }
    return JSON.parse(readFileSync(this.path, 'utf8')) as OnboardingDraft;
  }

  save(draft: OnboardingDraft): OnboardingDraft {
    if (draft.agent.provider.apiKey || draft.embedding.apiKey || draft.rerank.apiKey) {
      throw new Error('Onboarding drafts cannot persist plaintext secrets');
    }
    const saved: OnboardingDraft = {
      ...structuredClone(draft),
      revision: (this.load()?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(this.path, saved);
    return saved;
  }
}
