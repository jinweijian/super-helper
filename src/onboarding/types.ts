import type { ModelProviderConfig } from '../config.js';
import type { EmbeddingProviderConfig, RerankProviderConfig } from '../embedding/types.js';

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

export interface OnboardingSafeError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface OnboardingStageState {
  id: OnboardingStageId;
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
