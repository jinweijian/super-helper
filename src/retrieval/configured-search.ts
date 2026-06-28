import { defaultConfig, resolveEmbeddingSecret, resolveSecret, type SuperHelperConfig } from '../config.js';
import { loadKnowledgeTaxonomy } from '../knowledge/taxonomy.js';
import type { KnowledgeEvidencePack, KnowledgeSearchQuery } from '../knowledge/types.js';
import { formatProviderSafeError } from '../providers/errors.js';
import type { EmbeddingProvider } from '../providers/embedding/contract.js';
import { createEmbeddingProvider } from '../providers/embedding/factory.js';
import type { RerankProvider } from '../providers/rerank/contract.js';
import { createRerankProvider } from '../providers/rerank/factory.js';
import { normalizeAndExpandQuery } from './query/normalize.js';
import { createDefaultRetrievalStrategies } from './registry.js';
import { createProviderReranker } from './rerank/service.js';
import { createRetrievalService, type QueryNormalizer, type RetrievalService } from './service.js';
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
    // configured-search 注入带 taxonomy aliases 的 normalizer；service 不直接依赖 knowledge 模块。
    queryNormalizer: createConfiguredQueryNormalizer(),
  });
}

function createConfiguredQueryNormalizer(): QueryNormalizer {
  return (query, workspaceRoot) => {
    const taxonomy = loadKnowledgeTaxonomy(workspaceRoot);
    return normalizeAndExpandQuery({ query, aliases: taxonomy.aliases });
  };
}

export interface ConfiguredKnowledgeRetrievalResult {
  evidencePack: KnowledgeEvidencePack;
  trace: RetrievalTrace;
}

export type ConfiguredKnowledgeRetriever = (query: KnowledgeSearchQuery) => Promise<KnowledgeEvidencePack>;

export function createConfiguredKnowledgeRetriever(config: SuperHelperConfig): ConfiguredKnowledgeRetriever {
  return async (query) => {
    const result = await retrieveKnowledgeWithConfiguredRetrieval({ config, query });
    return result.evidencePack;
  };
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
  if (config.provider !== 'fake' && !resolveEmbeddingSecret(config)) {
    // 默认 enabled=true 但无 API key 时优雅降级为纯 BM25，避免 strategy 进入 failed 状态。
    return { reason: 'embedding unavailable: missing API key' };
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
  if (config.provider !== 'fake' && !resolveSecret(config.apiKey, config.apiKeyEnv)) {
    return { reason: 'rerank unavailable: missing API key' };
  }
  try {
    return { provider: createRerankProvider(config) };
  } catch (error) {
    return { reason: `rerank unavailable: ${formatProviderSafeError(error)}` };
  }
}
