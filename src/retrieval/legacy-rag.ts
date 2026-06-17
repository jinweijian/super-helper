import type { KnowledgeEvidencePack, KnowledgeSearchQuery } from '../knowledge/types.js';
import { createEmbeddingRecallStrategy } from './recall/embedding/strategy.js';
import { createKeywordRecallStrategy } from './recall/keyword/strategy.js';
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
  const strategies = [
    createKeywordRecallStrategy(),
    ...(input.embedding?.provider
      ? [createEmbeddingRecallStrategy({
        provider: input.embedding.provider,
        embeddingConfig: { enabled: true },
      })]
      : []),
  ];
  const service = createRetrievalService({
    strategies,
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
