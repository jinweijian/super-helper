import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ModelProviderConfig, SuperHelperConfig } from '../config.js';
import type { SecretRef } from '../domain.js';
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
import { providerHasExecutionCredentials } from './provider-credentials.js';
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
  OnboardingReviewIssue,
  OnboardingReviewQuery,
  OnboardingReviewSeverityFilter,
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
    const draft = this.loadEffectiveDraft();
    const review = draft ? this.getReviewState({ limit: 20 }) : emptyReviewState();
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
    const draft = this.toDraft(input, this.loadEffectiveDraft());
    this.dependencies.drafts.save(draft);
    return this.getState();
  }

  async validateDraft(): Promise<OnboardingValidationResult> {
    const draft = this.loadEffectiveDraft();
    if (!draft) {
      return {
        ok: false,
        issues: [{ field: 'draft', code: 'missing_draft', message: 'Onboarding draft is required.' }],
      };
    }
    return this.dependencies.validate(draft);
  }

  getReviewState(query?: OnboardingReviewQuery): OnboardingReviewState {
    const draft = this.loadEffectiveDraft();
    if (!draft) {
      return emptyReviewState(query);
    }
    return buildReviewState({
      workspaceRoot: knowledgeWorkspaceRootForDraft(draft, this.dependencies.config),
      query,
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

    return this.refreshReviewArtifacts(draft, workspaceRoot, input.query);
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

  private loadEffectiveDraft(): OnboardingDraft | undefined {
    return this.dependencies.drafts.load() ?? draftFromConfig(this.dependencies.config);
  }

  private toDraft(input: OnboardingDraftInput, previous?: OnboardingDraft): OnboardingDraft {
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
    preserveExistingSecretRefs(draft, previous, input.secrets);
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
    query?: OnboardingReviewQuery,
  ): Promise<OnboardingReviewResult> {
    const publish = publishApprovedDraftSlices({
      workspaceRoot,
      qualityGate: 'warn',
    });
    const index = updateKnowledgeIndex({ workspaceRoot, chunking: draft.knowledge.chunking });
    let vectorCount: number | undefined;
    if (
      draft.knowledge.buildVectorIndex
      && draft.embedding.enabled
      && providerHasExecutionCredentials(draft.embedding)
    ) {
      const executionDraft = materializeDraftSecrets(draft, this.dependencies.secrets);
      const provider = createEmbeddingProvider(executionDraft.embedding);
      const vector = await buildKnowledgeVectorIndex({
        workspaceRoot,
        provider,
        config: executionDraft.embedding,
      });
      vectorCount = vector.vectorCount;
    }
    const review = buildReviewState({ workspaceRoot, query });
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

interface NormalizedReviewQuery {
  offset: number;
  limit?: number;
  severity: OnboardingReviewSeverityFilter;
  search: string;
}

function emptyReviewState(query?: OnboardingReviewQuery): OnboardingReviewState {
  const normalized = normalizeReviewQuery(query);
  return {
    required: false,
    pendingCount: 0,
    blockedCount: 0,
    totalCount: 0,
    page: {
      offset: normalized.offset,
      limit: normalized.limit ?? 0,
      total: 0,
      returned: 0,
      hasMore: false,
      severity: normalized.severity,
      search: normalized.search,
    },
    items: [],
  };
}

function buildReviewState(input: { workspaceRoot: string; query?: OnboardingReviewQuery }): OnboardingReviewState {
  const query = normalizeReviewQuery(input.query);
  const draftsRoot = join(input.workspaceRoot, 'knowledge', '_pipeline', 'drafts');
  if (!existsSync(draftsRoot)) {
    return emptyReviewState(input.query);
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
          details: issue.details,
          explanation: explainReviewIssue(issue),
        })),
        excerptPreview: previewBody(parsed.body),
      });
    }
  }

  const pendingCount = items.filter((item) => item.qualitySeverity === 'warn').length;
  const blockedCount = items.filter((item) => item.qualitySeverity === 'error').length;
  const filteredItems = filterReviewItems(items, query);
  const limit = query.limit ?? filteredItems.length;
  const pageItems = filteredItems.slice(query.offset, query.offset + limit);
  return {
    required: items.length > 0,
    pendingCount,
    blockedCount,
    totalCount: items.length,
    page: {
      offset: query.offset,
      limit,
      total: filteredItems.length,
      returned: pageItems.length,
      hasMore: query.offset + pageItems.length < filteredItems.length,
      severity: query.severity,
      search: query.search,
    },
    items: pageItems,
  };
}

function normalizeReviewQuery(query?: OnboardingReviewQuery): NormalizedReviewQuery {
  const rawOffset = Number(query?.offset ?? 0);
  const rawLimit = query?.limit === undefined ? undefined : Number(query.limit);
  return {
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0,
    limit: rawLimit === undefined
      ? undefined
      : Math.max(1, Math.min(100, Math.floor(Number.isFinite(rawLimit) ? rawLimit : 20))),
    severity: normalizeReviewSeverity(query?.severity),
    search: query?.search?.trim() ?? '',
  };
}

function normalizeReviewSeverity(value: OnboardingReviewSeverityFilter | undefined): OnboardingReviewSeverityFilter {
  return value === 'warn' || value === 'error' || value === 'all' ? value : 'all';
}

function filterReviewItems(items: OnboardingReviewItem[], query: NormalizedReviewQuery): OnboardingReviewItem[] {
  const bySeverity = query.severity === 'all'
    ? items
    : items.filter((item) => item.qualitySeverity === query.severity);
  if (!query.search) {
    return bySeverity;
  }
  const needle = query.search.toLocaleLowerCase();
  return bySeverity.filter((item) => reviewSearchText(item).toLocaleLowerCase().includes(needle));
}

function reviewSearchText(item: OnboardingReviewItem): string {
  return [
    item.id,
    item.sourceDocumentId,
    item.title,
    item.module,
    item.path,
    item.qualitySeverity,
    item.qualityStatus,
    item.pipelineStatus,
    item.excerptPreview,
    ...item.issues.flatMap((issue) => [
      issue.code,
      issue.message,
      issue.explanation.reason,
      issue.explanation.impact,
      issue.explanation.suggestion,
      ...issue.explanation.missingInfo,
    ]),
  ].filter(Boolean).join('\n');
}

function explainReviewIssue(issue: KnowledgeQualityIssue): OnboardingReviewIssue['explanation'] {
  switch (issue.code) {
    case 'not_answer_bearing':
      return {
        reason: '原因：这段内容没有可直接回答用户问题的完整句子。',
        impact: '影响：发布后也不能作为高置信知识直答依据，容易只命中标题或背景词。',
        suggestion: '建议：补充一两句明确的规则、条件、操作步骤或结论后再发布。',
        missingInfo: ['可回答问题的完整句子', '明确的规则或操作结论'],
      };
    case 'missing_source_block_ids':
      return {
        reason: '原因：切片缺少 source_block_ids，无法定位到原始文档中的具体块。',
        impact: '影响：后续答案无法回溯原文证据，Evidence Review 会降低或阻断直答。',
        suggestion: '建议：重新 normalize/slice，或人工补齐原文块来源后再发布。',
        missingInfo: ['source_block_ids', '原文块级 provenance'],
      };
    case 'missing_source_blocks':
      return {
        reason: '原因：切片引用的部分 source_block_ids 在当前原文块记录中不存在。',
        impact: '影响：证据链断裂，无法证明切片内容确实来自对应源文档。',
        suggestion: '建议：重新抽取来源文档，或移除/修正失效的 source_block_ids。',
        missingInfo: ['有效的 source_block_ids', '可匹配的原文块记录'],
      };
    case 'missing_source_document':
      return {
        reason: '原因：切片缺少 source_document 来源路径。',
        impact: '影响：用户追问来源时无法定位文件，发布后证据可审计性不足。',
        suggestion: '建议：重新导入来源文档，或人工补齐 source_document。',
        missingInfo: ['source_document'],
      };
    case 'missing_source_document_id':
      return {
        reason: '原因：切片缺少 source_document_id。',
        impact: '影响：审核记录、发布记录和来源块无法稳定关联。',
        suggestion: '建议：重新走 intake/slice 流程，或人工补齐对应 source id。',
        missingInfo: ['source_document_id'],
      };
    case 'missing_section_path':
      return {
        reason: '原因：切片缺少 section_path，无法知道内容属于原文哪一节。',
        impact: '影响：召回时章节上下文不足，相关问题可能命中但解释不完整。',
        suggestion: '建议：从标题层级继承 section_path，或人工补齐章节路径。',
        missingInfo: ['section_path'],
      };
    case 'too_short':
      return {
        reason: '原因：切片正文长度低于质量阈值，信息量偏少。',
        impact: '影响：可能只有片段词或短说明，无法支撑稳定答案。',
        suggestion: '建议：合并相邻短切片，或补充完整上下文后再发布。',
        missingInfo: ['更完整的上下文', '相邻段落或完整规则描述'],
      };
    case 'too_long':
      return {
        reason: '原因：切片正文超过父切片长度阈值。',
        impact: '影响：一个切片可能覆盖过多上下文，召回后答案范围不清。',
        suggestion: '建议：按标题、列表或表格边界拆分为更聚焦的切片。',
        missingInfo: ['更细的主题边界', '拆分后的章节结构'],
      };
    case 'multi_topic_slice':
      return {
        reason: '原因：一个切片里混入多个主题或多个不相干标题。',
        impact: '影响：用户问其中一个主题时，系统可能带出无关内容。',
        suggestion: '建议：按主题拆分，确保每个切片只回答一类问题。',
        missingInfo: ['单一主题范围', '拆分后的标题或章节'],
      };
    case 'broken_coreference':
      return {
        reason: '原因：切片中存在“上述/该功能/这里”等无法独立理解的指代。',
        impact: '影响：离开原文上下文后，读者无法判断指代对象。',
        suggestion: '建议：把指代对象补全成具体名词或保留必要前文。',
        missingInfo: ['指代对象', '必要前文上下文'],
      };
    case 'toc_like':
      return {
        reason: '原因：切片内容像目录、导航或条目列表，而不是可回答内容。',
        impact: '影响：目录类内容通常只能说明结构，不能回答业务问题。',
        suggestion: '建议：不发布该切片，或改用目录下的实质段落重新切片。',
        missingInfo: ['目录条目对应的正文内容'],
      };
    case 'heading_only':
      return {
        reason: '原因：切片主要是标题，缺少实质正文。',
        impact: '影响：只能命中标题，无法解释具体规则或操作。',
        suggestion: '建议：补充标题下正文，或和下一段内容合并。',
        missingInfo: ['标题下的正文说明'],
      };
    case 'empty_body':
      return {
        reason: '原因：切片没有有效正文。',
        impact: '影响：发布后不会提供可用知识，只会制造噪音。',
        suggestion: '建议：不发布该切片，或重新从源文档抽取有效段落。',
        missingInfo: ['有效正文'],
      };
    case 'duplicate_content':
      return {
        reason: '原因：切片内容和另一个切片重复。',
        impact: '影响：重复知识会稀释召回结果，增加互相竞争的证据。',
        suggestion: '建议：只保留来源更完整、标题更准确的一条。',
        missingInfo: ['需要保留的权威版本'],
      };
    case 'low_signal_terms':
      return {
        reason: '原因：related_terms 数量不足，检索提示词偏少。',
        impact: '影响：用户用别名或业务词搜索时可能召回不到。',
        suggestion: '建议：补充产品名、功能名、常见问法和同义词。',
        missingInfo: ['related_terms', '常见业务别名'],
      };
    case 'source_provenance_missing':
      return {
        reason: '原因：源文档元数据缺少 sha256 或存储路径。',
        impact: '影响：无法证明内容来自哪个版本的源文件。',
        suggestion: '建议：重新 intake 源文件，生成完整 source metadata。',
        missingInfo: ['源文件 sha256', '源文件存储路径'],
      };
    case 'parser_empty':
    case 'too_many_unknown_blocks':
    case 'table_lost':
    case 'list_structure_lost':
    case 'heading_structure_broken':
    case 'toc_not_removed':
    case 'header_footer_noise':
    case 'duplicate_paragraphs':
    case 'missing_parent':
    case 'orphan_chunk':
      return {
        reason: `原因：质量审计发现 ${issue.code}，说明抽取、结构或索引链路存在异常。`,
        impact: '影响：该内容直接发布后可能缺上下文、结构错误或无法回溯。',
        suggestion: '建议：先检查源文档抽取/标准化报告，必要时重新处理或人工修正。',
        missingInfo: ['完整抽取结构', '可审计的来源和章节信息'],
      };
    default:
      return {
        reason: `原因：质量审计标记了 ${issue.code}。`,
        impact: '影响：该切片暂不满足自动发布质量门禁。',
        suggestion: '建议：按审计消息检查内容和来源后，再选择发布、退回或不发布。',
        missingInfo: ['人工审核结论'],
      };
  }
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

function draftFromConfig(config: SuperHelperConfig): OnboardingDraft {
  const workspace = config.workspaces[0] ?? {
    id: 'current',
    name: 'Current Project',
    rootPath: process.cwd(),
    mcpToolIds: [],
  };
  const providerId = activeModelProviderId(config);
  return {
    version: 1,
    revision: 0,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
    },
    knowledge: {
      rootDir: config.knowledge.rootDir,
      sourceDir: config.knowledge.sourceDir,
      buildVectorIndex: config.knowledge.buildVectorIndex,
      chunking: config.knowledge.chunking,
    },
    server: {
      bindMode: config.server.bindMode,
      host: config.server.host,
      port: config.server.port,
    },
    agent: {
      providerId,
      provider: providerForDraft(config.models.providers[providerId] ?? defaultOnboardingAgentProvider()),
    },
    embedding: providerForDraft(config.embedding),
    rerank: providerForDraft(config.rerank),
    updatedAt: config.onboarding.completedAt ?? new Date(0).toISOString(),
  };
}

function activeModelProviderId(config: SuperHelperConfig): string {
  if (config.agent.modelProvider && config.models.providers[config.agent.modelProvider]) {
    return config.agent.modelProvider;
  }
  return Object.keys(config.models.providers)[0] ?? 'default';
}

function defaultOnboardingAgentProvider(): ModelProviderConfig {
  return {
    type: 'openai-compatible',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: '',
  };
}

function providerForDraft<T extends { apiKey?: string; apiKeyEnv?: string; apiKeyRef?: SecretRef }>(provider: T): T {
  const copy = structuredClone(provider);
  if (!copy.apiKeyRef && copy.apiKeyEnv) {
    copy.apiKeyRef = { source: 'env', name: copy.apiKeyEnv };
  }
  delete copy.apiKey;
  delete copy.apiKeyEnv;
  return copy;
}

function preserveExistingSecretRefs(
  draft: OnboardingDraft,
  previous: OnboardingDraft | undefined,
  secrets: OnboardingDraftInput['secrets'] | undefined,
): void {
  if (
    !secrets?.agentApiKey
    && !draft.agent.provider.apiKeyRef
    && previous?.agent.providerId === draft.agent.providerId
    && previous.agent.provider.apiKeyRef
  ) {
    draft.agent.provider.apiKeyRef = previous.agent.provider.apiKeyRef;
  }
  preserveProviderSecretRef(draft.embedding, previous?.embedding, Boolean(secrets?.embeddingApiKey));
  preserveProviderSecretRef(draft.rerank, previous?.rerank, Boolean(secrets?.rerankApiKey));
}

function preserveProviderSecretRef<T extends { provider: string; apiKeyRef?: SecretRef }>(
  provider: T,
  previous: T | undefined,
  hasNewSecret: boolean,
): void {
  if (hasNewSecret || provider.apiKeyRef || !previous?.apiKeyRef) {
    return;
  }
  if (provider.provider !== previous.provider) {
    return;
  }
  provider.apiKeyRef = previous.apiKeyRef;
}

function sourceChangesForDraft(draft: OnboardingDraft): { added: string[]; changed: string[]; unchanged: string[] } {
  if (!draft.knowledge.sourceDir) {
    return { added: [], changed: [], unchanged: [] };
  }
  return { added: discoverSourceFiles(draft.knowledge.sourceDir), changed: [], unchanged: [] };
}

function vectorCompatibilityForDraft(draft: OnboardingDraft): 'compatible' | 'missing-index' | 'rebuild-required' {
  if (
    !draft.knowledge.buildVectorIndex
    || !draft.embedding.enabled
    || !providerHasExecutionCredentials(draft.embedding)
  ) {
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
