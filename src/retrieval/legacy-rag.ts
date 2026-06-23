import type { KnowledgeEvidencePack, KnowledgeSearchQuery } from '../knowledge/types.js';
import { createDefaultRetrievalStrategies } from './registry.js';
import { createProviderReranker } from './rerank/service.js';
import { createRetrievalService } from './service.js';

export interface KnowledgeRagSearchQuery extends KnowledgeSearchQuery {
  retrievalLimit?: number;
  embedding?: {
    provider: {
      embedQuery(input: { id?: string; text: string; metadata?: Record<string, unknown> }): Promise<{ vector: number[] }>;
    };
    limit?: number;
  };
  rerank?: {
    provider: {
      rerank(input: {
        query: string;
        documents: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>;
        topN?: number;
      }): Promise<{ results: Array<{ id: string; score: number; index?: number }> }>;
    };
    topN?: number;
  };
}

export async function searchKnowledgeWithRag(input: KnowledgeRagSearchQuery): Promise<KnowledgeEvidencePack> {
  const finalLimit = input.limit ?? 8;
  const retrievalLimit = input.retrievalLimit ?? Math.max(finalLimit * 4, 20);
  const service = createRetrievalService({
    strategies: createDefaultRetrievalStrategies({
      includeBm25: false,
      includeKeywordCompatibility: true,
      embeddingProvider: input.embedding?.provider,
      embeddingConfig: { enabled: Boolean(input.embedding?.provider) },
    }),
    reranker: createProviderReranker({
      provider: input.rerank?.provider,
      topN: input.rerank?.topN ?? finalLimit,
    }),
  });
  const result = await service.retrieve({
    workspaceRoot: input.workspaceRoot,
    query: input.query,
    moduleCandidates: input.moduleCandidates,
    intentCandidates: input.intentCandidates,
    sourceTypes: input.sourceTypes,
    visibility: input.visibility,
    limit: retrievalLimit,
  });
  return {
    ...result.evidence,
    results: result.evidence.results.slice(0, finalLimit),
    coverage: {
      ...result.evidence.coverage,
      matched_files: new Set(result.evidence.results.slice(0, finalLimit).map((item) => item.source)).size,
    },
  };
}
