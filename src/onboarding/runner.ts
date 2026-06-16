import type { SuperHelperConfig } from '../config.js';
import type { FileOnboardingDraftRepository } from './draft-repository.js';
import type { KnowledgeStageProgress } from './knowledge-pipeline.js';
import { calculateOverallProgress, OnboardingProgressHub } from './progress.js';
import type { FileOnboardingRunRepository } from './run-repository.js';
import type {
  OnboardingDraft,
  OnboardingPlan,
  OnboardingProgressEvent,
  OnboardingRun,
  OnboardingSafeError,
  OnboardingStageId,
  OnboardingStageState,
} from './types.js';

const KNOWLEDGE_STAGES: OnboardingStageId[] = [
  'ingest_sources',
  'extract_sources',
  'normalize_sources',
  'slice_sources',
  'audit_slices',
  'publish_approved',
  'build_keyword_index',
  'build_vector_index',
];

export function createOnboardingRun(input: {
  id: string;
  draft: OnboardingDraft;
  plan: OnboardingPlan;
  now: string;
}): OnboardingRun {
  return {
    id: input.id,
    status: 'pending',
    draftRevision: input.draft.revision,
    overallProgress: 0,
    stages: input.plan.stages.map((stage) => ({
      id: stage.id,
      action: stage.action,
      status: 'pending',
      progress: 0,
      total: stage.total,
      message: stage.reason,
    })),
    counters: {},
    startedAt: input.now,
    updatedAt: input.now,
  };
}

export interface OnboardingRunnerDependencies {
  drafts: FileOnboardingDraftRepository;
  runs: FileOnboardingRunRepository;
  progress: OnboardingProgressHub;
  validate(draft: OnboardingDraft): Promise<unknown>;
  testProviders(draft: OnboardingDraft): Promise<unknown>;
  prepareWorkspace(draft: OnboardingDraft): Promise<unknown>;
  runKnowledge(input: {
    draft: OnboardingDraft;
    startStage?: OnboardingStageId;
    report(progress: KnowledgeStageProgress): void;
  }): Promise<Record<string, unknown>>;
  healthCheck(draft: OnboardingDraft): Promise<Record<string, unknown>>;
  commitConfig(draft: OnboardingDraft, runId: string): Promise<SuperHelperConfig>;
  onConfigCommitted?(config: SuperHelperConfig): Promise<void> | void;
}

export class OnboardingRunner {
  constructor(private readonly dependencies: OnboardingRunnerDependencies) {}

  async execute(inputRun: OnboardingRun): Promise<OnboardingRun> {
    const active = this.dependencies.runs.findActive();
    if (active && active.id !== inputRun.id) {
      throw new Error(`Onboarding run already active: ${active.id}`);
    }

    const draft = this.dependencies.drafts.load();
    if (!draft) {
      throw new Error('No onboarding draft is available for execution.');
    }

    let run: OnboardingRun = {
      ...structuredClone(inputRun),
      status: 'running' as const,
      safeError: undefined,
      retryableStage: undefined,
      updatedAt: new Date().toISOString(),
    };
    run = this.saveAndPublish(run, 'run.started');

    try {
      for (const stage of run.stages) {
        if (stage.status === 'completed' || stage.status === 'skipped') {
          continue;
        }
        if (KNOWLEDGE_STAGES.includes(stage.id)) {
          if (stage.action === 'skip') {
            run = this.skipStage(run, stage.id);
            continue;
          }
          run = this.startStage(run, 'ingest_sources');
          run = await this.executeKnowledgeStages(run, draft);
          continue;
        }
        if (stage.action === 'skip') {
          run = this.skipStage(run, stage.id);
          continue;
        }
        run = await this.executeSingleStage(run, draft, stage.id);
      }

      run = {
        ...run,
        status: 'completed',
        currentStage: undefined,
        overallProgress: 100,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return this.saveAndPublish(run, 'run.completed');
    } catch (error) {
      return this.failRun(run, error);
    }
  }

  async retry(runId: string): Promise<OnboardingRun> {
    const run = this.dependencies.runs.load(runId);
    if (!run) {
      throw new Error(`Onboarding run not found: ${runId}`);
    }
    if (run.status !== 'failed') {
      throw new Error(`Onboarding run is not retryable: ${runId}`);
    }
    const retryIndex = Math.max(0, run.stages.findIndex((stage) => stage.id === run.retryableStage));
    const reset = {
      ...run,
      status: 'pending' as const,
      safeError: undefined,
      retryableStage: undefined,
      currentStage: undefined,
      updatedAt: new Date().toISOString(),
      stages: run.stages.map((stage, index) => index < retryIndex
        ? stage
        : {
            ...stage,
            status: 'pending' as const,
            progress: 0,
            processed: undefined,
            safeError: undefined,
            startedAt: undefined,
            completedAt: undefined,
          }),
    };
    return this.execute(this.dependencies.runs.save(reset));
  }

  private async executeSingleStage(
    run: OnboardingRun,
    draft: OnboardingDraft,
    stageId: OnboardingStageId,
  ): Promise<OnboardingRun> {
    let updated = this.startStage(run, stageId);
    if (stageId === 'validate_draft') {
      await this.dependencies.validate(draft);
    } else if (stageId === 'test_providers') {
      assertOk(await this.dependencies.testProviders(draft), 'Provider test failed.');
    } else if (stageId === 'prepare_workspace') {
      await this.dependencies.prepareWorkspace(draft);
    } else if (stageId === 'health_check') {
      const health = await this.dependencies.healthCheck(draft);
      assertOk(health, 'Health check failed.');
      updated = { ...updated, healthSummary: health };
    } else if (stageId === 'commit_config') {
      const config = await this.dependencies.commitConfig(draft, run.id);
      await this.dependencies.onConfigCommitted?.(config);
    }
    return this.completeStage(updated, stageId);
  }

  private async executeKnowledgeStages(run: OnboardingRun, draft: OnboardingDraft): Promise<OnboardingRun> {
    let updated = run;
    const counters = await this.dependencies.runKnowledge({
      draft,
      startStage: 'ingest_sources',
      report: (progress) => {
        updated = this.updateStageProgress(updated, progress);
      },
    });
    updated = {
      ...updated,
      counters: { ...updated.counters, ...numericCounters(counters) },
    };
    for (const stageId of KNOWLEDGE_STAGES) {
      const stage = findStage(updated, stageId);
      updated = stage.action === 'skip'
        ? this.skipStage(updated, stageId)
        : this.completeStage(updated, stageId);
    }
    return updated;
  }

  private startStage(run: OnboardingRun, stageId: OnboardingStageId): OnboardingRun {
    const now = new Date().toISOString();
    const updated = updateStage(run, stageId, (stage) => ({
      ...stage,
      status: 'running',
      progress: stage.progress,
      startedAt: stage.startedAt ?? now,
    }));
    return this.saveAndPublish({
      ...updated,
      status: 'running',
      currentStage: stageId,
      updatedAt: now,
      overallProgress: calculateOverallProgress(updated),
    }, 'stage.started');
  }

  private updateStageProgress(run: OnboardingRun, progress: KnowledgeStageProgress): OnboardingRun {
    const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 100;
    const now = new Date().toISOString();
    const updated = updateStage(run, progress.stage, (stage) => ({
      ...stage,
      status: 'running',
      progress: Math.max(0, Math.min(100, percent)),
      processed: progress.processed,
      total: progress.total,
      message: progress.message,
      startedAt: stage.startedAt ?? now,
    }));
    return this.saveAndPublish({
      ...updated,
      currentStage: progress.stage,
      updatedAt: now,
      overallProgress: calculateOverallProgress(updated),
    }, 'stage.progress');
  }

  private completeStage(run: OnboardingRun, stageId: OnboardingStageId): OnboardingRun {
    const now = new Date().toISOString();
    const updated = updateStage(run, stageId, (stage) => ({
      ...stage,
      status: 'completed',
      progress: 100,
      completedAt: stage.completedAt ?? now,
    }));
    return this.saveAndPublish({
      ...updated,
      currentStage: stageId,
      updatedAt: now,
      overallProgress: calculateOverallProgress(updated),
    }, 'stage.completed');
  }

  private skipStage(run: OnboardingRun, stageId: OnboardingStageId): OnboardingRun {
    const now = new Date().toISOString();
    const updated = updateStage(run, stageId, (stage) => ({
      ...stage,
      status: 'skipped',
      progress: 100,
      completedAt: stage.completedAt ?? now,
    }));
    return this.saveAndPublish({
      ...updated,
      currentStage: stageId,
      updatedAt: now,
      overallProgress: calculateOverallProgress(updated),
    }, 'stage.skipped');
  }

  private failRun(run: OnboardingRun, error: unknown): OnboardingRun {
    const now = new Date().toISOString();
    const stageId = run.currentStage ?? run.stages.find((stage) => stage.status === 'running')?.id;
    const safeError = safeOnboardingError(error);
    const staged = stageId
      ? updateStage(run, stageId, (stage) => ({ ...stage, status: 'failed', safeError }))
      : run;
    return this.saveAndPublish({
      ...staged,
      status: 'failed',
      retryableStage: stageId,
      safeError,
      updatedAt: now,
      overallProgress: calculateOverallProgress(staged),
    }, 'run.failed');
  }

  private saveAndPublish(run: OnboardingRun, type: OnboardingProgressEvent['type']): OnboardingRun {
    const saved = this.dependencies.runs.save(run);
    this.dependencies.progress.publish({
      type,
      runId: saved.id,
      at: new Date().toISOString(),
      run: saved,
    });
    return saved;
  }
}

function findStage(run: OnboardingRun, stageId: OnboardingStageId): OnboardingStageState {
  const stage = run.stages.find((item) => item.id === stageId);
  if (!stage) {
    throw new Error(`Unknown onboarding stage: ${stageId}`);
  }
  return stage;
}

function updateStage(
  run: OnboardingRun,
  stageId: OnboardingStageId,
  update: (stage: OnboardingStageState) => OnboardingStageState,
): OnboardingRun {
  return {
    ...run,
    stages: run.stages.map((stage) => stage.id === stageId ? update(stage) : stage),
  };
}

function assertOk(result: unknown, fallback: string): void {
  if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === false) {
    throw new Error(fallback);
  }
}

function numericCounters(value: Record<string, unknown>): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      counters[key] = item;
    }
  }
  return counters;
}

function safeOnboardingError(error: unknown): OnboardingSafeError {
  const raw = error instanceof Error ? error.message : String(error);
  return {
    code: 'onboarding_failed',
    message: redact(raw),
    retryable: true,
  };
}

function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]');
}
