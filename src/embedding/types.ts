import type { SecretRef } from '../domain.js';

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

export interface RerankProviderConfig {
  enabled: boolean;
  provider: 'siliconflow' | string;
  model: string;
  baseUrl?: string;
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyRef?: SecretRef;
  timeoutMs?: number;
  topN?: number;
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

export interface EmbeddingRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  batchSize?: number;
  requestId?: string;
}

export interface EmbeddingUsage {
  inputTokens?: number;
  totalTokens?: number;
  providerRequestCount?: number;
  raw?: Record<string, unknown>;
}

export interface EmbeddingVectorResult {
  id: string;
  provider: EmbeddingProviderId;
  model: string;
  dimensions: number;
  distance: EmbeddingDistanceMetric;
  vector: number[];
  usage?: EmbeddingUsage;
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingBatchResult {
  provider: EmbeddingProviderId;
  model: string;
  dimensions: number;
  distance: EmbeddingDistanceMetric;
  results: EmbeddingVectorResult[];
  usage?: EmbeddingUsage;
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

export interface RerankProviderHealthCheckResult {
  provider: string;
  model: string;
  ok: boolean;
  durationMs: number;
  topScore?: number;
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

  embedDocuments(input: EmbeddingDocumentInput[], options?: EmbeddingRequestOptions): Promise<EmbeddingBatchResult>;
  embedQuery(input: EmbeddingQueryInput, options?: EmbeddingRequestOptions): Promise<EmbeddingVectorResult>;
}

export type EmbeddingFetch = typeof fetch;

export interface EmbeddingProviderFactoryOptions {
  fetch?: EmbeddingFetch;
}
