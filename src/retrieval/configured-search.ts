import { defaultConfig, type SuperHelperConfig } from '../config.js';
import type { KnowledgeEvidencePack, KnowledgeSearchQuery } from '../knowledge/types.js';
import { formatProviderSafeError } from '../providers/errors.js';
import type { EmbeddingProvider } from '../providers/embedding/contract.js';
import { createEmbeddingProvider } from '../providers/embedding/factory.js';
import type { RerankProvider } from '../providers/rerank/contract.js';
import { createRerankProvider } from '../providers/rerank/factory.js';
import { createDefaultRetrievalStrategies } from './registry.js';
import { createProviderReranker } from './rerank/service.js';
import { createRetrievalService, type RetrievalService } from './service.js';
import type { RetrievalTrace } from './types.js';

interface ProviderResolution<T> {
  provider?: T;
  reason?: string;
}

export function createConfiguredRetrievalService(config: SuperHelperConfig): RetrievalService {
  const defaults = defaultConfig();
  const embeddingConfig = { ...defaults.embedding, ...config.embedding };
  const rerankConfig = { ...defaults.rerank, ...config.rerank };
  const embedding = resolveConfiguredEmbeddingProvider(embeddingConfig);
  const rerank = resolveConfiguredRerankProvider(rerankConfig);
  return createRetrievalService({
    strategies: createDefaultRetrievalStrategies({
      embeddingProvider: embedding.provider,
      embeddingConfig,
      embeddingUnavailableReason: embedding.reason,
    }),
    reranker: createProviderReranker({
      provider: rerank.provider,
      topN: rerankConfig.topN,
    }),
    rerankerUnavailableReason: rerank.reason,
    recallLimit: 40,
    fusionLimit: 20,
  });
}

export async function searchKnowledgeWithConfiguredRetrieval(input: {
  config: SuperHelperConfig;
  query: KnowledgeSearchQuery;
}): Promise<KnowledgeEvidencePack> {
  const result = await retrieveKnowledgeWithConfiguredRetrieval(input);
  return result.evidencePack;
}

export interface ConfiguredKnowledgeRetrievalResult {
  evidencePack: KnowledgeEvidencePack;
  trace: RetrievalTrace;
}

export async function retrieveKnowledgeWithConfiguredRetrieval(input: {
  config: SuperHelperConfig;
  query: KnowledgeSearchQuery;
}): Promise<ConfiguredKnowledgeRetrievalResult> {
  const finalLimit = Math.min(input.query.limit ?? 8, 8);
  const result = await createConfiguredRetrievalService(input.config).retrieve({
    workspaceRoot: input.query.workspaceRoot,
    query: input.query.query,
    moduleCandidates: input.query.moduleCandidates,
    intentCandidates: input.query.intentCandidates,
    sourceTypes: input.query.sourceTypes,
    visibility: input.query.visibility,
    limit: finalLimit,
  });
  const results = result.evidence.results.slice(0, finalLimit);
  return {
    evidencePack: {
      ...result.evidence,
      results,
      coverage: {
        ...result.evidence.coverage,
        matched_files: new Set(results.map((item) => item.source)).size,
      },
    },
    trace: {
      ...result.trace,
      fusion: { ...result.trace.fusion, finalCandidateCount: results.length },
      rerank: { ...result.trace.rerank },
      strategies: result.trace.strategies.map((strategy) => ({ ...strategy })),
      filters: result.trace.filters.map((filter) => ({ ...filter })),
    },
  };
}

function resolveConfiguredEmbeddingProvider(
  config: SuperHelperConfig['embedding'],
): ProviderResolution<EmbeddingProvider> {
  if (config.enabled !== true) {
    return { reason: 'embedding disabled' };
  }
  try {
    return { provider: createEmbeddingProvider(config) };
  } catch (error) {
    return { reason: `embedding unavailable: ${formatProviderSafeError(error)}` };
  }
}

function resolveConfiguredRerankProvider(
  config: SuperHelperConfig['rerank'],
): ProviderResolution<RerankProvider> {
  if (config.enabled !== true) {
    return { reason: 'rerank disabled' };
  }
  try {
    return { provider: createRerankProvider(config) };
  } catch (error) {
    return { reason: `rerank unavailable: ${formatProviderSafeError(error)}` };
  }
}
