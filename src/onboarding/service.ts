import { randomUUID } from 'node:crypto';
import type { SuperHelperConfig } from '../config.js';
import { createEmbeddingProvider } from '../embedding/index.js';
import {
  checkKnowledgeVectorCompatibility,
  discoverSourceFiles,
  initKnowledgeWorkspace,
} from '../knowledge/index.js';
import { commitOnboardingConfig } from './config-commit.js';
import { FileOnboardingDraftRepository } from './draft-repository.js';
import { runOnboardingKnowledgePipeline } from './knowledge-pipeline.js';
import { buildOnboardingPlan } from './planner.js';
import { OnboardingProgressHub } from './progress.js';
import { testOnboardingProviders } from './provider-tests.js';
import { FileOnboardingRunRepository } from './run-repository.js';
import { createOnboardingRun, OnboardingRunner } from './runner.js';
import { FileSecretsRepository } from './secrets.js';
import type {
  OnboardingDraft,
  OnboardingDraftInput,
  OnboardingProgressEvent,
  OnboardingRun,
  OnboardingValidationResult,
  PublicOnboardingState,
} from './types.js';
import { validateOnboardingDraft } from './validator.js';

export class OnboardingService {
  constructor(private readonly dependencies: {
    config: SuperHelperConfig;
    drafts: FileOnboardingDraftRepository;
    runs: FileOnboardingRunRepository;
    secrets: FileSecretsRepository;
    progress: OnboardingProgressHub;
    runner: Pick<OnboardingRunner, 'execute' | 'retry'>;
    validate(draft: OnboardingDraft): OnboardingValidationResult;
  }) {}

  getState(): PublicOnboardingState {
    const draft = this.dependencies.drafts.load();
    return {
      completed: Boolean(this.dependencies.config.onboarding.completedAt),
      draft: draft ? sanitizeDraft(draft, this.dependencies.secrets) : undefined,
      latestRun: this.dependencies.runs.latest(),
      validation: draft ? this.dependencies.validate(draft) : undefined,
    };
  }

  async saveDraft(input: OnboardingDraftInput): Promise<PublicOnboardingState> {
    rejectUnsafeDraftInput(input);
    const draft = this.toDraft(input);
    this.dependencies.drafts.save(draft);
    return this.getState();
  }

  async validateDraft(): Promise<OnboardingValidationResult> {
    const draft = this.dependencies.drafts.load();
    if (!draft) {
      return {
        ok: false,
        issues: [{ field: 'draft', code: 'missing_draft', message: 'Onboarding draft is required.' }],
      };
    }
    return this.dependencies.validate(draft);
  }

  async startRun(): Promise<OnboardingRun> {
    const active = this.dependencies.runs.findActive();
    if (active) {
      throw new Error(`onboarding run already active: ${active.id}`);
    }
    const draft = this.dependencies.drafts.load();
    if (!draft) {
      throw new Error('onboarding draft is required');
    }
    const run = this.dependencies.runs.save(createOnboardingRun({
      id: `run_${randomUUID()}`,
      draft,
      plan: buildOnboardingPlan({
        draft,
        sourceChanges: sourceChangesForDraft(draft),
        keywordIndexDirty: true,
        vectorCompatibility: vectorCompatibilityForDraft(draft),
      }),
      now: new Date().toISOString(),
    }));
    queueMicrotask(() => {
      void this.dependencies.runner.execute(run);
    });
    return run;
  }

  getRun(id: string): OnboardingRun | undefined {
    return this.dependencies.runs.load(id);
  }

  retryRun(id: string): Promise<OnboardingRun> {
    return this.dependencies.runner.retry(id);
  }

  subscribe(id: string, listener: (event: OnboardingProgressEvent) => void): () => void {
    return this.dependencies.progress.subscribe(id, listener);
  }

  recoverInterrupted(): OnboardingRun[] {
    return this.dependencies.runs.recoverInterrupted();
  }

  private toDraft(input: OnboardingDraftInput): OnboardingDraft {
    const draft: OnboardingDraft = {
      ...structuredClone(input.draft),
      revision: 0,
      updatedAt: new Date().toISOString(),
      agent: {
        providerId: input.draft.agent.providerId,
        provider: structuredClone(input.draft.agent.provider),
      },
      embedding: structuredClone(input.draft.embedding),
      rerank: structuredClone(input.draft.rerank),
    };
    if (input.secrets?.agentApiKey) {
      draft.agent.provider.apiKeyRef = this.dependencies.secrets.set(
        `providers.agent.${draft.agent.providerId}`,
        input.secrets.agentApiKey,
      );
    }
    if (input.secrets?.embeddingApiKey) {
      draft.embedding.apiKeyRef = this.dependencies.secrets.set('providers.embedding', input.secrets.embeddingApiKey);
    }
    if (input.secrets?.rerankApiKey) {
      draft.rerank.apiKeyRef = this.dependencies.secrets.set('providers.rerank', input.secrets.rerankApiKey);
    }
    return draft;
  }
}

export function createOnboardingService(input: {
  config: SuperHelperConfig;
  onConfigCommitted?(config: SuperHelperConfig): Promise<void> | void;
}): OnboardingService {
  const root = input.config.storage.rootDir;
  const drafts = new FileOnboardingDraftRepository(root);
  const runs = new FileOnboardingRunRepository(root);
  const secrets = new FileSecretsRepository(root);
  const progress = new OnboardingProgressHub();
  const runner = new OnboardingRunner({
    drafts,
    runs,
    progress,
    validate: async (draft) => {
      const result = validateOnboardingDraft(draft, { resolveSecret: (ref) => secrets.resolve(ref) });
      if (!result.ok) {
        throw new Error(`Onboarding draft is invalid: ${result.issues.map((issue) => issue.field).join(', ')}`);
      }
    },
    testProviders: testOnboardingProviders,
    prepareWorkspace: async (draft) => {
      initKnowledgeWorkspace({ workspaceRoot: draft.knowledge.rootDir, sourceDir: draft.knowledge.sourceDir, qualityGate: 'off' });
    },
    runKnowledge: async (runInput) => {
      const result = await runOnboardingKnowledgePipeline({
        draft: runInput.draft,
        workspaceRoot: runInput.draft.knowledge.rootDir,
        report: runInput.report,
      });
      return { ...result } as Record<string, unknown>;
    },
    healthCheck: async () => ({ ok: true }),
    commitConfig: async (draft, runId) => commitOnboardingConfig({
      draft,
      currentConfig: input.config,
      runId,
    }),
    onConfigCommitted: input.onConfigCommitted,
  });
  return new OnboardingService({
    config: input.config,
    drafts,
    runs,
    secrets,
    progress,
    runner,
    validate: (draft) => validateOnboardingDraft(draft, { resolveSecret: (ref) => secrets.resolve(ref) }),
  });
}

function rejectUnsafeDraftInput(input: OnboardingDraftInput): void {
  const provider = input.draft.agent.provider as Record<string, unknown>;
  const embedding = input.draft.embedding as Record<string, unknown>;
  const rerank = input.draft.rerank as Record<string, unknown>;
  if (provider.apiKey || provider.apiKeyEnv || embedding.apiKey || embedding.apiKeyEnv || rerank.apiKey || rerank.apiKeyEnv) {
    throw new Error('Onboarding draft input cannot include plaintext secrets or apiKeyEnv; use secrets or env apiKeyRef.');
  }
  for (const [field, ref] of [
    ['agent.provider.apiKeyRef', input.draft.agent.provider.apiKeyRef],
    ['embedding.apiKeyRef', input.draft.embedding.apiKeyRef],
    ['rerank.apiKeyRef', input.draft.rerank.apiKeyRef],
  ] as const) {
    if (ref && ref.source !== 'env') {
      throw new Error(`${field} must be an env SecretRef in public input.`);
    }
  }
}

function sanitizeDraft(draft: OnboardingDraft, secrets: FileSecretsRepository): Record<string, unknown> {
  return {
    version: draft.version,
    revision: draft.revision,
    workspace: draft.workspace,
    knowledge: draft.knowledge,
    server: draft.server,
    agent: {
      providerId: draft.agent.providerId,
      provider: sanitizeProvider(draft.agent.provider, secrets),
    },
    embedding: sanitizeProvider(draft.embedding, secrets),
    rerank: sanitizeProvider(draft.rerank, secrets),
    updatedAt: draft.updatedAt,
  };
}

function sanitizeProvider<T extends { apiKeyRef?: OnboardingDraft['agent']['provider']['apiKeyRef'] }>(
  provider: T,
  secrets: FileSecretsRepository,
): Omit<T, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> & { apiKeyRef?: Record<string, string>; hasApiKey: boolean } {
  const { apiKey: _apiKey, apiKeyEnv: _apiKeyEnv, apiKeyRef, ...rest } = provider as T & {
    apiKey?: string;
    apiKeyEnv?: string;
  };
  return {
    ...rest,
    apiKeyRef: apiKeyRef ? sanitizeSecretRef(apiKeyRef) : undefined,
    hasApiKey: secrets.has(apiKeyRef),
  };
}

function sanitizeSecretRef(ref: NonNullable<OnboardingDraft['agent']['provider']['apiKeyRef']>): Record<string, string> {
  return ref.source === 'env'
    ? { source: 'env', name: ref.name }
    : { source: 'file' };
}

function sourceChangesForDraft(draft: OnboardingDraft): { added: string[]; changed: string[]; unchanged: string[] } {
  if (!draft.knowledge.sourceDir) {
    return { added: [], changed: [], unchanged: [] };
  }
  return { added: discoverSourceFiles(draft.knowledge.sourceDir), changed: [], unchanged: [] };
}

function vectorCompatibilityForDraft(draft: OnboardingDraft): 'compatible' | 'missing-index' | 'rebuild-required' {
  if (!draft.knowledge.buildVectorIndex || !draft.embedding.enabled) {
    return 'compatible';
  }
  try {
    createEmbeddingProvider(draft.embedding);
    return checkKnowledgeVectorCompatibility({
      workspaceRoot: draft.knowledge.rootDir,
      embeddingConfig: draft.embedding,
    }).status;
  } catch {
    return 'rebuild-required';
  }
}
