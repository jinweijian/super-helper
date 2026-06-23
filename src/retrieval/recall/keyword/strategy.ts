import { searchKnowledgeCompatibility } from '../../compatibility-search.js';
import type { RetrievalCandidate } from '../../types.js';
import type { RecallInput, RecallStrategy } from '../contract.js';

export function createKeywordRecallStrategy(): RecallStrategy {
  return {
    id: 'keyword',
    kind: 'lexical',
    enabled: () => ({ enabled: true }),
    async recall(input: RecallInput) {
      const pack = searchKnowledgeCompatibility({
        workspaceRoot: input.workspaceRoot,
        query: input.query,
        moduleCandidates: input.moduleCandidates,
        intentCandidates: input.intentCandidates,
        sourceTypes: input.sourceTypes,
        visibility: input.visibility,
        limit: input.limit,
      });
      const candidates: RetrievalCandidate[] = pack.results.map((result) => ({
        id: result.chunk_id ?? result.document_id,
        chunkId: result.chunk_id,
        documentId: result.document_id,
        parentId: result.parent_id,
        source: result.source,
        sourceDocument: result.source_document,
        sourceDocumentId: result.source_document_id,
        sourcePages: result.source_pages,
        sourceBlockIds: result.source_block_ids,
        sectionPath: result.section_path,
        title: result.title,
        type: result.type,
        module: result.module,
        intent: result.intent,
        sourceType: result.source_type,
        confidence: result.confidence,
        status: result.status,
        visibility: result.visibility,
        lastVerifiedAt: result.last_verified_at,
        matchedTerms: result.matched_terms,
        summary: result.summary,
        excerpt: result.excerpt,
        answerSpan: result.answer_span,
        quality: result.quality,
        groundingIssues: result.grounding_issues,
        text: [result.title, result.summary, result.excerpt].join('\n'),
        score: result.score,
        metadata: {
          evidence: result,
        },
      }));
      return { candidates };
    },
  };
}
