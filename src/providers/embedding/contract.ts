import type { SecretRef } from '../../domain.js';
import type {
  ProviderFactoryOptions,
  ProviderFetch,
  ProviderRequestOptions,
  ProviderUsage,
} from '../http.js';

export type EmbeddingProviderId = 'siliconflow' | 'minimax' | 'gemini' | 'qwen' | 'fake';

export type EmbeddingDistanceMetric = 'cosine' | 'dot' | 'euclidean';

export interface EmbeddingProviderConfig {
  enabled: boolean;
  provider: EmbeddingProviderId | string;
  model: string;
  baseUrl?: string;
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyRef?: SecretRef;
  dimensions: number;
  distance: EmbeddingDistanceMetric | string;
  batchSize?: number;
  timeoutMs?: number;
  extra?: Record<string, unknown>;
}

export interface EmbeddingDocumentInput {
  id: string;
  text: string;
  contentHash?: string;
  source?: string;
  documentId?: string;
  chunkId?: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingQueryInput {
  id?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingVectorResult {
  id: string;
  provider: EmbeddingProviderId;
  model: string;
  dimensions: number;
  distance: EmbeddingDistanceMetric;
  vector: number[];
  usage?: ProviderUsage;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingBatchResult {
  provider: EmbeddingProviderId;
  model: string;
  dimensions: number;
  distance: EmbeddingDistanceMetric;
  results: EmbeddingVectorResult[];
  usage?: ProviderUsage;
  warnings: string[];
}

export interface EmbeddingProviderHealthCheckResult {
  provider: EmbeddingProviderId;
  model: string;
  dimensions: number;
  ok: boolean;
  durationMs: number;
  error?: {
    code: string;
    status?: number;
    retryable: boolean;
    safeMessage: string;
  };
}

export interface EmbeddingProvider {
  readonly id: EmbeddingProviderId;
  readonly model: string;
  readonly dimensions: number;
  readonly distance: EmbeddingDistanceMetric;

  embedDocuments(input: EmbeddingDocumentInput[], options?: ProviderRequestOptions): Promise<EmbeddingBatchResult>;
  embedQuery(input: EmbeddingQueryInput, options?: ProviderRequestOptions): Promise<EmbeddingVectorResult>;
}

export type EmbeddingFetch = ProviderFetch;
export type EmbeddingRequestOptions = ProviderRequestOptions;
export type EmbeddingUsage = ProviderUsage;
export type EmbeddingProviderFactoryOptions = ProviderFactoryOptions;
