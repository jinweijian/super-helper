import { readKnowledgeChunks } from '../../../knowledge/indexes/chunks.js';
import type { RetrievalCandidate } from '../../types.js';
import type { RecallInput, RecallStrategy } from '../contract.js';
import { scoreBm25 } from './scorer.js';
import { tokenizeForBm25 } from './tokenizer.js';

export function createBm25RecallStrategy(): RecallStrategy {
  return {
    id: 'bm25',
    kind: 'lexical',
    enabled: () => ({ enabled: true }),
    async recall(input: RecallInput) {
      const loaded = readKnowledgeChunks(input.workspaceRoot);
      const queryTokens = tokenizeForBm25(input.query);
      const documents = loaded.chunks
        .filter((chunk) => chunk.status === 'active')
        .map((chunk) => ({
          id: chunk.chunk_id,
          tokens: tokenizeForBm25([
            chunk.text,
            chunk.module,
            chunk.intent,
            chunk.source_type,
            ...(chunk.keywords ?? []),
            ...(chunk.headings ?? []),
          ].join(' ')),
        }));
      const chunkById = new Map(loaded.chunks.map((chunk) => [chunk.chunk_id, chunk]));
      const candidates: RetrievalCandidate[] = scoreBm25({ queryTokens, documents })
        .slice(0, input.limit)
        .flatMap((scored) => {
          const chunk = chunkById.get(scored.id);
          if (!chunk) {
            return [];
          }
          return [{
            id: chunk.chunk_id,
            chunkId: chunk.chunk_id,
            documentId: chunk.parent_id,
            parentId: chunk.parent_id,
            source: chunk.source,
            title: chunk.headings[0],
            module: chunk.module,
            intent: chunk.intent,
            sourceType: chunk.source_type,
            confidence: chunk.confidence,
            status: chunk.status,
            visibility: chunk.visibility ?? 'internal',
            matchedTerms: scored.matchedTerms,
            summary: chunk.headings[0] ?? chunk.source,
            excerpt: chunk.text.slice(0, 500),
            text: chunk.text,
            score: scored.score,
          }];
        });
      return { candidates };
    },
  };
}
