import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { SuperHelperConfig } from '../config.js';
import { createEmbeddingProvider } from '../providers/embedding/factory.js';
import {
  buildKnowledgeVectorIndex,
  checkKnowledgeVectorCompatibility,
  discoverSourceFiles,
  initKnowledgeWorkspace,
  parseMarkdownDocument,
  publishApprovedDraftSlices,
  readDraftSlices,
  readKnowledgeQualityReport,
  resolveKnowledgeWorkspaceRoot,
  reviewDraftSlices,
  updateKnowledgeIndex,
} from '../knowledge/index.js';
import type { KnowledgeFrontmatter, KnowledgeQualityIssue, KnowledgeQualityReport } from '../knowledge/index.js';
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
  OnboardingReviewInput,
  OnboardingReviewItem,
  OnboardingReviewResult,
  OnboardingReviewState,
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
    const review = draft ? this.getReviewState() : emptyReviewState();
    return {
      completed: Boolean(this.dependencies.config.onboarding.completedAt),
      needsReview: review.required,
      draft: draft ? sanitizeDraft(draft, this.dependencies.secrets) : undefined,
      latestRun: this.dependencies.runs.latest(),
      validation: draft ? this.dependencies.validate(draft) : undefined,
      review,
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

  getReviewState(): OnboardingReviewState {
    const draft = this.dependencies.drafts.load();
    if (!draft) {
      return emptyReviewState();
    }
    return buildReviewState({
      workspaceRoot: knowledgeWorkspaceRootForDraft(draft, this.dependencies.config),
    });
  }

  async submitReview(input: OnboardingReviewInput): Promise<OnboardingReviewResult> {
    const draft = this.dependencies.drafts.load();
    if (!draft) {
      throw new Error('onboarding draft is required');
    }
    const action = normalizeReviewAction(input.action);
    const reviewer = input.reviewer?.trim() || 'super-helper-dashboard';
    const notes = input.notes?.trim() || (action === 'accept_warnings'
      ? 'Dashboard reviewer accepted warning-quality slices for publish.'
      : 'Dashboard reviewer updated onboarding draft slices.');
    const workspaceRoot = knowledgeWorkspaceRootForDraft(draft, this.dependencies.config);
    const current = buildReviewState({ workspaceRoot });
    const targets = selectReviewTargets(current.items, input);
    if (targets.length === 0) {
      return {
        review: current,
        publishedSlices: 0,
        indexedDocuments: 0,
        indexedChunks: 0,
      };
    }
    const blocked = targets.filter((item) => item.qualitySeverity === 'error');
    if (blocked.length > 0 && (action === 'approve' || action === 'accept_warnings')) {
      throw new Error(`blocked slices cannot be approved without repair: ${blocked.map((item) => item.id).join(', ')}`);
    }

    const bySource = groupReviewTargets(targets);
    for (const [sourceDocumentId, ids] of bySource.entries()) {
      reviewDraftSlices({
        workspaceRoot,
        sourceDocumentId,
        action,
        reviewer,
        notes,
        ids,
      });
    }

    return this.refreshReviewArtifacts(draft, workspaceRoot);
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

  private async refreshReviewArtifacts(
    draft: OnboardingDraft,
    workspaceRoot: string,
  ): Promise<OnboardingReviewResult> {
    const publish = publishApprovedDraftSlices({
      workspaceRoot,
      qualityGate: 'warn',
    });
    const index = updateKnowledgeIndex({ workspaceRoot });
    let vectorCount: number | undefined;
    if (draft.knowledge.buildVectorIndex && draft.embedding.enabled) {
      const executionDraft = materializeDraftSecrets(draft, this.dependencies.secrets);
      const provider = createEmbeddingProvider(executionDraft.embedding);
      const vector = await buildKnowledgeVectorIndex({
        workspaceRoot,
        provider,
        config: executionDraft.embedding,
      });
      vectorCount = vector.vectorCount;
    }
    const review = buildReviewState({ workspaceRoot });
    this.updateLatestRunCounters({
      pendingReviewSlices: review.pendingCount,
      blockedSlices: review.blockedCount,
      publishedSlicesDelta: publish.publishedIds.length,
      indexedDocuments: index.documentCount,
      indexedChunks: index.chunkCount,
      vectorCount,
    });
    return {
      review,
      publishedSlices: publish.publishedIds.length,
      indexedDocuments: index.documentCount,
      indexedChunks: index.chunkCount,
      vectorCount,
    };
  }

  private updateLatestRunCounters(input: {
    pendingReviewSlices: number;
    blockedSlices: number;
    publishedSlicesDelta: number;
    indexedDocuments: number;
    indexedChunks: number;
    vectorCount?: number;
  }): void {
    const latest = this.dependencies.runs.latest();
    if (!latest) {
      return;
    }
    this.dependencies.runs.save({
      ...latest,
      counters: {
        ...latest.counters,
        pendingReviewSlices: input.pendingReviewSlices,
        blockedSlices: input.blockedSlices,
        publishedSlices: (latest.counters.publishedSlices ?? 0) + input.publishedSlicesDelta,
        indexedDocuments: input.indexedDocuments,
        indexedChunks: input.indexedChunks,
        ...(input.vectorCount === undefined ? {} : { vectorCount: input.vectorCount }),
      },
      updatedAt: new Date().toISOString(),
    });
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
      initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspaceRootForDraft(draft, input.config), qualityGate: 'off' });
    },
    materializeDraftSecrets: (draft) => materializeDraftSecrets(draft, secrets),
    runKnowledge: async (runInput) => {
      const result = await runOnboardingKnowledgePipeline({
        draft: runInput.draft,
        workspaceRoot: knowledgeWorkspaceRootForDraft(runInput.draft, input.config),
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
    onConfigCommitted: async (config) => {
      Object.assign(input.config, config);
      await input.onConfigCommitted?.(config);
    },
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

function emptyReviewState(): OnboardingReviewState {
  return {
    required: false,
    pendingCount: 0,
    blockedCount: 0,
    items: [],
  };
}

function buildReviewState(input: { workspaceRoot: string }): OnboardingReviewState {
  const draftsRoot = join(input.workspaceRoot, 'knowledge', '_pipeline', 'drafts');
  if (!existsSync(draftsRoot)) {
    return emptyReviewState();
  }
  const quality = readKnowledgeQualityReport(input.workspaceRoot);
  const items: OnboardingReviewItem[] = [];
  const sourceDocumentIds = readdirSync(draftsRoot)
    .filter((name) => {
      const fullPath = join(draftsRoot, name);
      return statSync(fullPath).isDirectory();
    })
    .sort();

  for (const sourceDocumentId of sourceDocumentIds) {
    for (const slice of readDraftSlices(input.workspaceRoot, sourceDocumentId)) {
      const parsed = parseMarkdownDocument(readFileSync(slice.path, 'utf8'), slice.path);
      if (isReviewFinished(parsed.frontmatter.pipeline_status)) {
        continue;
      }
      const issues = qualityIssuesForSlice(quality, parsed.frontmatter, sourceDocumentId);
      const severity = reviewSeverity(parsed.frontmatter, issues);
      if (severity === 'ok') {
        continue;
      }
      items.push({
        id: parsed.frontmatter.id,
        sourceDocumentId,
        title: parsed.frontmatter.title,
        module: parsed.frontmatter.module,
        path: relative(input.workspaceRoot, slice.path).replaceAll('\\', '/'),
        qualitySeverity: severity,
        qualityStatus: parsed.frontmatter.quality_status,
        pipelineStatus: parsed.frontmatter.pipeline_status,
        issues: issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          message: issue.message,
          source: issue.source,
        })),
        excerptPreview: previewBody(parsed.body),
      });
    }
  }

  const pendingCount = items.filter((item) => item.qualitySeverity === 'warn').length;
  const blockedCount = items.filter((item) => item.qualitySeverity === 'error').length;
  return {
    required: items.length > 0,
    pendingCount,
    blockedCount,
    items,
  };
}

function isReviewFinished(status: KnowledgeFrontmatter['pipeline_status']): boolean {
  return status === 'approved' || status === 'published' || status === 'rejected';
}

function qualityIssuesForSlice(
  quality: KnowledgeQualityReport | undefined,
  frontmatter: KnowledgeFrontmatter,
  sourceDocumentId: string,
): KnowledgeQualityIssue[] {
  if (!quality) {
    return [];
  }
  return quality.issues.filter((issue) => {
    if (issue.documentId === frontmatter.id) return true;
    if (issue.sourceDocument === sourceDocumentId) return true;
    if (issue.sourceDocument === frontmatter.source_document_id) return true;
    if (issue.source === frontmatter.source_document) return true;
    return false;
  });
}

function reviewSeverity(
  frontmatter: KnowledgeFrontmatter,
  issues: KnowledgeQualityIssue[],
): 'ok' | 'warn' | 'error' {
  if (frontmatter.quality_status === 'error' || frontmatter.pipeline_status === 'quality_error') {
    return 'error';
  }
  if (issues.some((issue) => issue.severity === 'error')) {
    return 'error';
  }
  if (
    frontmatter.quality_status === 'warn' ||
    frontmatter.pipeline_status === 'quality_warn' ||
    frontmatter.pipeline_status === 'review_required' ||
    issues.some((issue) => issue.severity === 'warn')
  ) {
    return 'warn';
  }
  return 'ok';
}

function previewBody(body: string): string {
  return body
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function normalizeReviewAction(action: OnboardingReviewInput['action']): OnboardingReviewInput['action'] {
  if (!['approve', 'reject', 'request_edits', 'accept_warnings'].includes(action)) {
    throw new Error(`invalid review action: ${action}`);
  }
  return action;
}

function selectReviewTargets(
  items: OnboardingReviewItem[],
  input: OnboardingReviewInput,
): OnboardingReviewItem[] {
  const ids = new Set(input.ids ?? []);
  return items.filter((item) => {
    if (input.sourceDocumentId && item.sourceDocumentId !== input.sourceDocumentId) {
      return false;
    }
    if (ids.size > 0 && !ids.has(item.id)) {
      return false;
    }
    return true;
  });
}

function groupReviewTargets(items: OnboardingReviewItem[]): Map<string, string[]> {
  const bySource = new Map<string, string[]>();
  for (const item of items) {
    bySource.set(item.sourceDocumentId, [...(bySource.get(item.sourceDocumentId) ?? []), item.id]);
  }
  return bySource;
}

function knowledgeWorkspaceRootForDraft(draft: OnboardingDraft, currentConfig: SuperHelperConfig): string {
  const config = structuredClone(currentConfig);
  config.knowledge = {
    ...config.knowledge,
    rootDir: draft.knowledge.rootDir,
  };
  config.workspaces = [{
    id: draft.workspace.id,
    name: draft.workspace.name,
    rootPath: draft.workspace.rootPath,
    mcpToolIds: config.workspaces.find((workspace) => workspace.id === draft.workspace.id)?.mcpToolIds ?? [],
  }];
  return resolveKnowledgeWorkspaceRoot(config, draft.workspace.id);
}

function materializeDraftSecrets(draft: OnboardingDraft, secrets: FileSecretsRepository): OnboardingDraft {
  const copy = structuredClone(draft);
  copy.agent.provider.apiKey = secrets.resolve(copy.agent.provider.apiKeyRef) ?? copy.agent.provider.apiKey;
  copy.embedding.apiKey = secrets.resolve(copy.embedding.apiKeyRef) ?? copy.embedding.apiKey;
  copy.rerank.apiKey = secrets.resolve(copy.rerank.apiKeyRef) ?? copy.rerank.apiKey;
  return copy;
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
