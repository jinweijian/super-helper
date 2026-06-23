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
  });
}

export async function searchKnowledgeWithConfiguredRetrieval(input: {
  config: SuperHelperConfig;
  query: KnowledgeSearchQuery;
}): Promise<KnowledgeEvidencePack> {
  const finalLimit = input.query.limit ?? 8;
  const retrievalLimit = Math.max(finalLimit * 4, 20);
  const result = await createConfiguredRetrievalService(input.config).retrieve({
    workspaceRoot: input.query.workspaceRoot,
    query: input.query.query,
    moduleCandidates: input.query.moduleCandidates,
    intentCandidates: input.query.intentCandidates,
    sourceTypes: input.query.sourceTypes,
    visibility: input.query.visibility,
    limit: retrievalLimit,
  });
  const results = result.evidence.results.slice(0, finalLimit);
  return {
    ...result.evidence,
    results,
    coverage: {
      ...result.evidence.coverage,
      matched_files: new Set(results.map((item) => item.source)).size,
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
