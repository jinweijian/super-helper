import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-json.js';
import { onboardingRunPath, onboardingRunsRoot } from './paths.js';
import type { OnboardingRun } from './types.js';

export class FileOnboardingRunRepository {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  save(run: OnboardingRun): OnboardingRun {
    const saved = structuredClone(run);
    writeJsonAtomic(onboardingRunPath(this.rootDir, run.id), saved);
    return saved;
  }

  load(id: string): OnboardingRun | undefined {
    const path = onboardingRunPath(this.rootDir, id);
    if (!existsSync(path)) {
      return undefined;
    }
    return JSON.parse(readFileSync(path, 'utf8')) as OnboardingRun;
  }

  latest(): OnboardingRun | undefined {
    return this.list().at(0);
  }

  list(): OnboardingRun[] {
    const root = onboardingRunsRoot(this.rootDir);
    if (!existsSync(root)) {
      return [];
    }
    return readdirSync(root)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')) as OnboardingRun)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  findActive(): OnboardingRun | undefined {
    return this.list().find((run) => run.status === 'pending' || run.status === 'running');
  }

  recoverInterrupted(): OnboardingRun[] {
    const recovered: OnboardingRun[] = [];
    for (const run of this.list()) {
      if (run.status !== 'running') {
        continue;
      }
      const updated: OnboardingRun = {
        ...run,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        retryableStage: run.currentStage,
        safeError: {
          code: 'interrupted',
          message: 'Onboarding was interrupted while the service was not running.',
          retryable: true,
        },
      };
      recovered.push(this.save(updated));
    }
    return recovered;
  }
}
