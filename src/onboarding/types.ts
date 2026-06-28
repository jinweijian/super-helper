import type { SecretRef } from '../domain.js';
import type { ModelProviderConfig } from '../config.js';
import type { KnowledgeChunkingOptions } from '../knowledge/documents/chunks.js';
import type { EmbeddingProviderConfig } from '../providers/embedding/contract.js';
import type { RerankProviderConfig } from '../providers/rerank/contract.js';

type EnvSecretRef = Extract<SecretRef, { source: 'env' }>;

export type OnboardingModelProviderInput =
  Omit<ModelProviderConfig, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> & {
    apiKeyRef?: EnvSecretRef;
  };

export type OnboardingEmbeddingInput =
  Omit<EmbeddingProviderConfig, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> & {
    apiKeyRef?: EnvSecretRef;
  };

export type OnboardingRerankInput =
  Omit<RerankProviderConfig, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> & {
    apiKeyRef?: EnvSecretRef;
  };

export type OnboardingStageId =
  | 'validate_draft'
  | 'test_providers'
  | 'prepare_workspace'
  | 'ingest_sources'
  | 'extract_sources'
  | 'normalize_sources'
  | 'slice_sources'
  | 'audit_slices'
  | 'publish_approved'
  | 'build_keyword_index'
  | 'build_vector_index'
  | 'health_check'
  | 'commit_config';

export type OnboardingStatus = 'pending' | 'running' | 'failed' | 'completed';
export type OnboardingStageStatus = 'pending' | 'running' | 'failed' | 'completed' | 'skipped';

export interface OnboardingDraft {
  version: 1;
  revision: number;
  workspace: {
    id: string;
    name: string;
    rootPath: string;
  };
  knowledge: {
    rootDir: string;
    sourceDir?: string;
    buildVectorIndex: boolean;
    chunking?: KnowledgeChunkingOptions;
  };
  server: {
    bindMode: 'loopback' | 'lan';
    host?: string;
    port: number;
  };
  agent: {
    providerId: string;
    provider: ModelProviderConfig;
  };
  embedding: EmbeddingProviderConfig;
  rerank: RerankProviderConfig;
  updatedAt: string;
}

export interface OnboardingDraftInput {
  draft: Omit<OnboardingDraft, 'revision' | 'updatedAt' | 'agent' | 'embedding' | 'rerank'> & {
    agent: {
      providerId: string;
      provider: OnboardingModelProviderInput;
    };
    embedding: OnboardingEmbeddingInput;
    rerank: OnboardingRerankInput;
  };
  secrets?: {
    agentApiKey?: string;
    embeddingApiKey?: string;
    rerankApiKey?: string;
  };
}

export interface OnboardingSafeError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface OnboardingStageState {
  id: OnboardingStageId;
  action?: 'run' | 'skip';
  status: OnboardingStageStatus;
  progress: number;
  processed?: number;
  total?: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  safeError?: OnboardingSafeError;
}

export interface OnboardingRun {
  id: string;
  status: OnboardingStatus;
  draftRevision: number;
  currentStage?: OnboardingStageId;
  overallProgress: number;
  stages: OnboardingStageState[];
  counters: Record<string, number>;
  safeError?: OnboardingSafeError;
  retryableStage?: OnboardingStageId;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  healthSummary?: Record<string, unknown>;
}

export interface OnboardingProgressEvent {
  type:
    | 'run.started'
    | 'stage.started'
    | 'stage.progress'
    | 'stage.completed'
    | 'stage.skipped'
    | 'stage.failed'
    | 'run.completed'
    | 'run.failed';
  runId: string;
  at: string;
  run: OnboardingRun;
}

export interface PublicOnboardingState {
  completed: boolean;
  needsReview: boolean;
  draft?: Record<string, unknown>;
  latestRun?: OnboardingRun;
  validation?: OnboardingValidationResult;
  review?: OnboardingReviewState;
}

export interface OnboardingValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface OnboardingValidationResult {
  ok: boolean;
  issues: OnboardingValidationIssue[];
}

export interface OnboardingPlanStage {
  id: OnboardingStageId;
  action: 'run' | 'skip';
  reason: string;
  total?: number;
}

export interface OnboardingPlan {
  stages: OnboardingPlanStage[];
  stage(id: OnboardingStageId): OnboardingPlanStage;
}

export type OnboardingReviewAction = 'approve' | 'reject' | 'request_edits' | 'accept_warnings';

export type OnboardingReviewSeverityFilter = 'all' | 'warn' | 'error';

export interface OnboardingReviewQuery {
  offset?: number;
  limit?: number;
  severity?: OnboardingReviewSeverityFilter;
  search?: string;
}

export interface OnboardingReviewPage {
  offset: number;
  limit: number;
  total: number;
  returned: number;
  hasMore: boolean;
  severity: OnboardingReviewSeverityFilter;
  search: string;
}

export interface OnboardingReviewIssueExplanation {
  reason: string;
  impact: string;
  suggestion: string;
  missingInfo: string[];
}

export interface OnboardingReviewIssue {
  code: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  details?: Record<string, unknown>;
  explanation: OnboardingReviewIssueExplanation;
}

export interface OnboardingReviewItem {
  id: string;
  sourceDocumentId: string;
  title: string;
  module: string;
  path: string;
  qualitySeverity: 'warn' | 'error';
  qualityStatus?: string;
  pipelineStatus?: string;
  issues: OnboardingReviewIssue[];
  excerptPreview: string;
}

export interface OnboardingReviewState {
  required: boolean;
  pendingCount: number;
  blockedCount: number;
  totalCount: number;
  page: OnboardingReviewPage;
  items: OnboardingReviewItem[];
}

export interface OnboardingReviewInput {
  action: OnboardingReviewAction;
  reviewer?: string;
  notes?: string;
  sourceDocumentId?: string;
  ids?: string[];
  query?: OnboardingReviewQuery;
}

export interface OnboardingReviewResult {
  review: OnboardingReviewState;
  publishedSlices: number;
  indexedDocuments: number;
  indexedChunks: number;
  vectorCount?: number;
}
