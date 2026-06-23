import type {
  KnowledgeEvidencePack,
  KnowledgeEvidenceResult,
} from '../knowledge/types.js';
import { tokenizeForBm25 } from './recall/bm25/tokenizer.js';
import type { RetrievalCandidate, RetrievalInput } from './types.js';

export function retrievalCandidatesToEvidencePack(input: {
  request: RetrievalInput;
  candidates: RetrievalCandidate[];
  filteredOut?: Array<{ reason: string; count: number }>;
}): KnowledgeEvidencePack {
  const keywords = tokenizeForBm25(input.request.query);
  const results: KnowledgeEvidenceResult[] = input.candidates.map((candidate) => ({
    evidence_id: `ev_kb_${(candidate.chunkId ?? candidate.documentId).replace(/^chk_/, '')}`,
    document_id: candidate.documentId,
    parent_id: candidate.parentId ?? candidate.documentId,
    chunk_id: candidate.chunkId,
    source: candidate.source,
    source_document: candidate.sourceDocument,
    source_document_id: candidate.sourceDocumentId,
    source_pages: candidate.sourcePages,
    source_block_ids: candidate.sourceBlockIds,
    section_path: candidate.sectionPath,
    title: candidate.title ?? candidate.source,
    type: candidate.type ?? 'module_overview',
    module: candidate.module ?? 'general',
    intent: candidate.intent ?? 'how_to',
    source_type: candidate.sourceType ?? 'module_doc',
    confidence: candidate.confidence ?? 'medium',
    status: candidate.status ?? 'active',
    visibility: candidate.visibility ?? 'internal',
    last_verified_at: candidate.lastVerifiedAt,
    matched_terms: candidate.matchedTerms ?? [],
    summary: candidate.summary ?? candidate.title ?? candidate.source,
    excerpt: candidate.excerpt ?? candidate.text.slice(0, 500),
    answer_span: candidate.answerSpan,
    grounding_issues: candidate.groundingIssues,
    taxonomy_known: candidate.taxonomyKnown,
    score: candidate.finalScore ?? candidate.score,
    retrieval: retrievalMetadata(candidate),
    quality: candidate.quality,
  }));
  return {
    query: {
      normalized_question: input.request.query.toLowerCase().replace(/\s+/g, ''),
      module_candidates: input.request.moduleCandidates ?? [],
      intent_candidates: input.request.intentCandidates ?? [],
      keywords,
    },
    results,
    coverage: {
      searched_files: new Set(input.candidates.map((candidate) => candidate.source)).size,
      matched_files: new Set(results.map((result) => result.source)).size,
      filtered_out: input.filteredOut ?? [],
    },
  };
}

function retrievalMetadata(candidate: RetrievalCandidate): KnowledgeEvidenceResult['retrieval'] {
  const keywordScore = candidate.strategyScores?.find((item) => item.strategyId === 'keyword' || item.strategyId === 'bm25')?.score;
  const vectorScore = candidate.strategyScores?.find((item) => item.strategyId === 'embedding')?.score;
  return {
    source: candidate.rerankScore !== undefined
      ? 'rerank'
      : keywordScore !== undefined && vectorScore !== undefined
        ? 'hybrid'
        : vectorScore !== undefined
          ? 'vector'
          : 'keyword',
    keywordScore,
    vectorScore,
    rerankScore: candidate.rerankScore,
    fieldContributions: isNumberRecord(candidate.metadata?.bm25FieldContributions)
      ? candidate.metadata.bm25FieldContributions
      : undefined,
  };
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'number');
}
