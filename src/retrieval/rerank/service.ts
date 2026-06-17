import type { RetrievalCandidate } from '../types.js';

export interface RetrievalReranker {
  rerank(input: {
    query: string;
    candidates: RetrievalCandidate[];
    limit: number;
  }): Promise<{ candidates: RetrievalCandidate[] }>;
}

export function createProviderReranker(input: {
  provider?: {
    rerank(input: {
      query: string;
      documents: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>;
      topN?: number;
    }): Promise<{ results: Array<{ id: string; score: number; index?: number }> }>;
  };
  topN?: number;
}): RetrievalReranker | undefined {
  if (!input.provider) {
    return undefined;
  }
  return {
    async rerank(request) {
      const documents = request.candidates.map((candidate) => ({
        id: candidate.chunkId ?? candidate.id,
        text: candidate.text,
        metadata: candidate.metadata,
      }));
      const result = await input.provider!.rerank({
        query: request.query,
        documents,
        topN: input.topN ?? request.limit,
      });
      const byId = new Map(request.candidates.map((candidate) => [candidate.chunkId ?? candidate.id, candidate]));
      const used = new Set<string>();
      const reranked: RetrievalCandidate[] = [];
      for (const item of result.results) {
        const candidate = byId.get(item.id);
        if (!candidate || used.has(item.id)) {
          continue;
        }
        used.add(item.id);
        reranked.push({
          ...candidate,
          rerankScore: item.score,
          finalScore: Number(((candidate.finalScore ?? candidate.score) + item.score).toFixed(8)),
        });
      }
      return {
        candidates: [
          ...reranked,
          ...request.candidates.filter((candidate) => !used.has(candidate.chunkId ?? candidate.id)),
        ],
      };
    },
  };
}
