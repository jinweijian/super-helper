import { loadKnowledgeChunksForSearch } from '../knowledge/documents/chunks.js';
import { discoverKnowledgeDocuments } from '../knowledge/documents/discovery.js';
import { extractKnowledgeTerms, normalizeKnowledgeText } from '../knowledge/documents/terms.js';
import { loadChunkQualityMap } from '../knowledge/quality.js';
import { selectAnswerSpan } from './answer-span.js';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeEvidencePack,
  KnowledgeEvidenceResult,
  KnowledgeSearchQuery,
  KnowledgeSourceType,
  KnowledgeVisibility,
} from '../knowledge/types.js';

const sourceTypeWeight: Record<string, number> = {
  faq: 100,
  runbook: 95,
  solved_case: 90,
  whitepaper: 70,
  glossary: 50,
  module_doc: 45,
  ticket: 30,
  unresolved_case: 10,
};

const confidenceWeight: Record<string, number> = {
  high: 20,
  medium: 10,
  low: 0,
};

export function searchKnowledgeCompatibility(input: KnowledgeSearchQuery): KnowledgeEvidencePack {
  const docs = discoverKnowledgeDocuments(input.workspaceRoot);
  const docById = new Map(docs.map((document) => [document.frontmatter.id, document]));
  const chunks = loadKnowledgeChunksForSearch(input.workspaceRoot, docs);
  const normalized = normalizeKnowledgeText(input.query);
  const queryKeywords = keywordsFromQuery(input.query);
  const moduleCandidates = input.moduleCandidates?.length ? input.moduleCandidates : inferModules(queryKeywords, docs);
  const intentCandidates = input.intentCandidates ?? [];
  const filteredOut = new Map<string, number>();
  const qualityMap = loadChunkQualityMap(input.workspaceRoot);

  const rankedResults = chunks
    .map((chunk) => {
      const parent = docById.get(chunk.parent_id);
      if (!parent) {
        increment(filteredOut, 'missing_parent');
        return undefined;
      }
      if (!passesFilters(parent, input, moduleCandidates, intentCandidates)) {
        increment(filteredOut, 'metadata_filter');
        return undefined;
      }
      if (parent.frontmatter.status === 'archived' || parent.frontmatter.status === 'deprecated') {
        increment(filteredOut, parent.frontmatter.status);
        return undefined;
      }

      const scoreInfo = scoreChunk(chunk, parent, queryKeywords, normalized);
      if (scoreInfo.score <= 0) return undefined;
      return toEvidenceResult(chunk, parent, scoreInfo.score, scoreInfo.matchedTerms, qualityMap);
    })
    .filter((item): item is KnowledgeEvidenceResult => Boolean(item))
    .sort((left, right) => right.score - left.score);
  const results = dedupeEvidenceByParent(rankedResults).slice(0, input.limit ?? 8);

  return {
    query: {
      normalized_question: normalized,
      module_candidates: moduleCandidates,
      intent_candidates: intentCandidates,
      keywords: queryKeywords,
    },
    results,
    coverage: {
      searched_files: docs.length,
      matched_files: new Set(results.map((result) => result.source)).size,
      filtered_out: Array.from(filteredOut.entries()).map(([reason, count]) => ({ reason, count })),
    },
  };
}

function dedupeEvidenceByParent(results: KnowledgeEvidenceResult[]): KnowledgeEvidenceResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.parent_id)) return false;
    seen.add(result.parent_id);
    return true;
  });
}

export const searchKnowledge = searchKnowledgeCompatibility;

export function keywordsFromQuery(value: string): string[] {
  return extractKnowledgeTerms(value);
}

function toEvidenceResult(
  chunk: KnowledgeChunk,
  parent: KnowledgeDocument,
  score: number,
  matchedTerms: string[],
  qualityMap: Map<string, { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] }>,
): KnowledgeEvidenceResult {
  const quality = qualityMap.get(parent.frontmatter.id) ?? qualityFromFrontmatter(parent);
  const excerpt = excerptFor(parent.body, matchedTerms);
  return {
    evidence_id: `ev_kb_${chunk.chunk_id.replace(/^chk_/, '')}`,
    document_id: parent.frontmatter.id,
    parent_id: parent.frontmatter.id,
    chunk_id: chunk.chunk_id,
    source: parent.relativePath,
    source_document: parent.frontmatter.source_document ?? chunk.source_document,
    source_document_id: parent.frontmatter.source_document_id ?? chunk.source_document_id,
    source_pages: parent.frontmatter.source_pages ?? chunk.source_pages ?? [],
    source_block_ids: parent.frontmatter.source_block_ids,
    section_path: parent.frontmatter.section_path,
    title: parent.frontmatter.title,
    type: parent.frontmatter.type,
    module: parent.frontmatter.module,
    intent: parent.frontmatter.intent,
    source_type: parent.frontmatter.source_type,
    confidence: parent.frontmatter.confidence,
    status: parent.frontmatter.status,
    visibility: parent.frontmatter.visibility,
    last_verified_at: parent.frontmatter.last_verified_at,
    matched_terms: matchedTerms,
    summary: `${parent.frontmatter.title} 命中：${matchedTerms.join('、') || parent.frontmatter.module}`,
    excerpt,
    answer_span: selectAnswerSpan({ text: parent.body, matchedTerms }),
    score,
    retrieval: { source: 'keyword', keywordScore: score },
    quality,
  };
}

function qualityFromFrontmatter(
  parent: KnowledgeDocument,
): KnowledgeEvidenceResult['quality'] {
  const severity = parent.frontmatter.quality_status;
  if (!severity || severity === 'unchecked') {
    return undefined;
  }
  return { severity, issues: [] };
}

function scoreChunk(
  chunk: KnowledgeChunk,
  parent: KnowledgeDocument,
  queryKeywords: string[],
  normalizedQuery: string,
): { score: number; matchedTerms: string[] } {
  const haystack = normalizeKnowledgeText([chunk.text, parent.frontmatter.title, parent.frontmatter.related_terms.join(' ')].join('\n'));
  const matchedTerms = Array.from(new Set(queryKeywords.filter((keyword) => haystack.includes(normalizeKnowledgeText(keyword)))));
  const exactKeywordMatches = chunk.keywords.filter((keyword) => normalizedQuery.includes(normalizeKnowledgeText(keyword)));
  const score =
    matchedTerms.length * 6 +
    exactKeywordMatches.length * 10 +
    (sourceTypeWeight[parent.frontmatter.source_type] ?? 0) +
    (confidenceWeight[parent.frontmatter.confidence] ?? 0) +
    (parent.frontmatter.status === 'active' ? 8 : 0);
  return {
    score: matchedTerms.length || exactKeywordMatches.length ? score : 0,
    matchedTerms: Array.from(new Set([...exactKeywordMatches, ...matchedTerms])).slice(0, 12),
  };
}

function passesFilters(
  parent: KnowledgeDocument,
  input: KnowledgeSearchQuery,
  moduleCandidates: string[],
  intentCandidates: string[],
): boolean {
  if (moduleCandidates.length > 0 && !moduleCandidates.includes(parent.frontmatter.module)) return false;
  if (intentCandidates.length > 0 && !intentCandidates.includes(parent.frontmatter.intent)) return false;
  if (input.sourceTypes?.length && !input.sourceTypes.includes(parent.frontmatter.source_type as KnowledgeSourceType)) return false;
  if (input.visibility?.length && !input.visibility.includes(parent.frontmatter.visibility as KnowledgeVisibility)) return false;
  if (input.productVersions?.length) {
    const docVersions = parent.frontmatter.product_versions;
    if (docVersions.length > 0 && !input.productVersions.some((version) => docVersions.includes(version))) return false;
  }
  return true;
}

function inferModules(queryKeywords: string[], docs: KnowledgeDocument[]): string[] {
  const modules = new Set<string>();
  for (const document of docs) {
    const searchable = normalizeKnowledgeText([
      document.frontmatter.module,
      document.frontmatter.title,
      ...document.frontmatter.related_terms,
    ].join('\n'));
    if (queryKeywords.some((keyword) => searchable.includes(normalizeKnowledgeText(keyword)))) {
      modules.add(document.frontmatter.module);
    }
  }
  return Array.from(modules);
}

function stripMarkdown(body: string): string {
  return body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function excerptFor(body: string, matchedTerms: string[]): string {
  const stripped = stripMarkdown(body).replace(/\s+/g, ' ').trim();
  if (!stripped) return '';
  const firstMatch = matchedTerms
    .map((term) => stripped.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  return stripped.slice(Math.max(0, firstMatch - 80), Math.max(0, firstMatch - 80) + 320);
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
