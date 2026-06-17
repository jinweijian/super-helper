import type { SecretRef } from '../../domain.js';
import type {
  ProviderRequestOptions,
  ProviderUsage,
} from '../http.js';

export interface RerankProviderConfig {
  enabled: boolean;
  provider: 'siliconflow' | 'fake' | string;
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

export interface RerankDocumentInput {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RerankRequestInput {
  query: string;
  documents: RerankDocumentInput[];
  topN?: number;
}

export interface RerankDocumentResult {
  id: string;
  score: number;
  index?: number;
}

export interface RerankBatchResult {
  provider: string;
  model: string;
  results: RerankDocumentResult[];
  usage?: ProviderUsage;
  warnings: string[];
}

export interface RerankProvider {
  readonly id: string;
  readonly model: string;
  rerank(input: RerankRequestInput, options?: ProviderRequestOptions): Promise<RerankBatchResult>;
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
