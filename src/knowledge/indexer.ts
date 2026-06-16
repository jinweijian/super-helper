import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseMarkdownDocument } from './frontmatter.js';
import { chunksPath, dirtyFlagPath, keywordIndexPath, knowledgeRoot, manifestPath, relativeKnowledgePath } from './paths.js';
import {
  auditKnowledgeQuality,
  evaluateQualityGate,
  loadChunkQualityMap,
  type KnowledgeQualityGate,
  writeKnowledgeQualityReport,
  writeSourceQualityReport,
} from './quality.js';
import { readKnowledgeVectorRecords } from './vector-index.js';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeEvidencePack,
  KnowledgeEvidenceResult,
  KnowledgeIndexManifest,
  KnowledgeRagSearchQuery,
  KnowledgeSearchQuery,
  KnowledgeSourceDocument,
  KnowledgeSourceType,
  KnowledgeUpdateResult,
  KnowledgeVectorRecord,
  KnowledgeVisibility,
} from './types.js';

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

export function updateKnowledgeIndex(input: { workspaceRoot: string }): KnowledgeUpdateResult {
  const root = knowledgeRoot(input.workspaceRoot);
  const docs = discoverKnowledgeDocuments(input.workspaceRoot);
  const sourceDocuments = loadSourceDocuments(input.workspaceRoot);
  const chunks = docs.flatMap((document) => chunkDocument(document));
  const manifest: KnowledgeIndexManifest = {
    version: 1,
    updated_at: new Date().toISOString(),
    document_count: docs.length,
    chunk_count: chunks.length,
    source_document_count: sourceDocuments.length,
    documents: docs.map((document) => ({
      id: document.frontmatter.id,
      path: document.relativePath,
      title: document.frontmatter.title,
      type: document.frontmatter.type,
      module: document.frontmatter.module,
      intent: document.frontmatter.intent,
      status: document.frontmatter.status,
      confidence: document.frontmatter.confidence,
    })),
  };

  mkdirSync(join(root, 'indexes'), { recursive: true });
  writeFileSync(chunksPath(input.workspaceRoot), chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + (chunks.length ? '\n' : ''), 'utf8');
  writeFileSync(manifestPath(input.workspaceRoot), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(keywordIndexPath(input.workspaceRoot), `${JSON.stringify(buildKeywordIndex(chunks), null, 2)}\n`, 'utf8');
  if (existsSync(dirtyFlagPath(input.workspaceRoot))) {
    rmSync(dirtyFlagPath(input.workspaceRoot), { force: true });
  }

  return {
    knowledgeRoot: root,
    documentCount: docs.length,
    chunkCount: chunks.length,
    sourceDocumentCount: sourceDocuments.length,
    manifestPath: manifestPath(input.workspaceRoot),
    chunksPath: chunksPath(input.workspaceRoot),
  };
}

export function updateKnowledgeIndexWithQuality(input: {
  workspaceRoot: string;
  qualityGate?: KnowledgeQualityGate;
}): KnowledgeUpdateResult {
  const gate = input.qualityGate ?? 'warn';
  const result = updateKnowledgeIndex({ workspaceRoot: input.workspaceRoot });
  if (gate === 'off') {
    return {
      ...result,
      qualityGateResult: { passed: true, exitCode: 0, reason: 'quality gate disabled' },
    };
  }
  const report = auditKnowledgeQuality({ workspaceRoot: input.workspaceRoot, gate });
  const qualityReportPath = writeKnowledgeQualityReport({ workspaceRoot: input.workspaceRoot, report });
  const sourceQualityReportPath = writeSourceQualityReport({ workspaceRoot: input.workspaceRoot, report });
  return {
    ...result,
    qualityReportPath,
    sourceQualityReportPath,
    qualityGateResult: evaluateQualityGate(report, gate),
    qualitySeverityCounts: report.severityCounts,
    qualityIssueCounts: report.issueCounts,
  };
}

export function searchKnowledge(input: KnowledgeSearchQuery): KnowledgeEvidencePack {
  const docs = discoverKnowledgeDocuments(input.workspaceRoot);
  const docById = new Map(docs.map((document) => [document.frontmatter.id, document]));
  const chunks = loadChunks(input.workspaceRoot, docs);
  const normalized = normalizeText(input.query);
  const queryKeywords = keywordsFromQuery(input.query);
  const moduleCandidates = input.moduleCandidates?.length ? input.moduleCandidates : inferModules(queryKeywords, docs);
  const intentCandidates = input.intentCandidates ?? [];
  const filteredOut = new Map<string, number>();
  const qualityMap = loadChunkQualityMap(input.workspaceRoot);

  const results = chunks
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
      if (scoreInfo.score <= 0) {
        return undefined;
      }
      return toEvidenceResult(chunk, parent, scoreInfo.score, scoreInfo.matchedTerms, qualityMap);
    })
    .filter((item): item is KnowledgeEvidenceResult => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 8);

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

export async function searchKnowledgeWithRag(input: KnowledgeRagSearchQuery): Promise<KnowledgeEvidencePack> {
  const finalLimit = input.limit ?? 8;
  const retrievalLimit = input.retrievalLimit ?? Math.max(finalLimit * 4, 20);
  const keywordPack = searchKnowledge({ ...input, limit: retrievalLimit });
  const docs = discoverKnowledgeDocuments(input.workspaceRoot);
  const docById = new Map(docs.map((document) => [document.frontmatter.id, document]));
  const chunks = loadChunks(input.workspaceRoot, docs);
  const chunkById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
  const normalized = normalizeText(input.query);
  const queryKeywords = keywordsFromQuery(input.query);
  const moduleCandidates = input.moduleCandidates?.length ? input.moduleCandidates : inferModules(queryKeywords, docs);
  const intentCandidates = input.intentCandidates ?? [];
  const qualityMap = loadChunkQualityMap(input.workspaceRoot);
  const filteredOut = [...keywordPack.coverage.filtered_out];

  let results: KnowledgeEvidenceResult[] = keywordPack.results.map((result) => ({
    ...result,
    retrieval: { source: 'keyword' as const, keywordScore: result.score },
  }));

  if (input.embedding?.provider) {
    try {
      const vectorResults = await recallVectorKnowledge({
        input,
        docById,
        chunkById,
        queryKeywords,
        normalized,
        moduleCandidates,
        intentCandidates,
        qualityMap,
        limit: input.embedding.limit ?? retrievalLimit,
      });
      results = mergeEvidenceResults(results, vectorResults);
    } catch {
      filteredOut.push({ reason: 'vector_recall_failed', count: 1 });
    }
  }

  if (input.rerank?.provider && results.length > 0) {
    try {
      results = await rerankEvidenceResults(input, results, input.rerank.topN ?? finalLimit);
    } catch {
      filteredOut.push({ reason: 'rerank_failed', count: 1 });
      results.sort((a, b) => b.score - a.score);
    }
  } else {
    results.sort((a, b) => b.score - a.score);
  }

  const finalResults = results.slice(0, finalLimit);
  return {
    query: keywordPack.query,
    results: finalResults,
    coverage: {
      searched_files: docs.length,
      matched_files: new Set(finalResults.map((result) => result.source)).size,
      filtered_out: filteredOut,
    },
  };
}

export function discoverKnowledgeDocuments(workspaceRoot: string): KnowledgeDocument[] {
  const root = knowledgeRoot(workspaceRoot);
  if (!existsSync(root)) {
    return [];
  }

  return listMarkdownFiles(root)
    .filter((path) => !shouldSkipMarkdown(root, path))
    .flatMap((path) => {
      try {
        const parsed = parseMarkdownDocument(readFileSync(path, 'utf8'), relativeKnowledgePath(workspaceRoot, path));
        return [{
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          headings: extractHeadings(parsed.body),
          path,
          relativePath: relativeKnowledgePath(workspaceRoot, path),
        }];
      } catch {
        return [];
      }
    });
}

export function loadSourceDocuments(workspaceRoot: string): KnowledgeSourceDocument[] {
  const root = join(knowledgeRoot(workspaceRoot), '_sources');
  if (!existsSync(root)) {
    return [];
  }
  return listFiles(root)
    .filter((path) => path.endsWith('.meta.json'))
    .flatMap((path) => {
      try {
        return [JSON.parse(readFileSync(path, 'utf8')) as KnowledgeSourceDocument];
      } catch {
        return [];
      }
    });
}

function loadChunks(workspaceRoot: string, docs: KnowledgeDocument[]): KnowledgeChunk[] {
  const path = chunksPath(workspaceRoot);
  if (existsSync(path) && !existsSync(dirtyFlagPath(workspaceRoot))) {
    const parsed = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as KnowledgeChunk];
        } catch {
          return [];
        }
      });
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return docs.flatMap((document) => chunkDocument(document));
}

function chunkDocument(document: KnowledgeDocument): KnowledgeChunk[] {
  const frontmatter = document.frontmatter;
  const text = buildChunkText(document);
  if (!text.trim()) {
    return [];
  }

  return [{
    chunk_id: `chk_${slug(frontmatter.id)}_001`,
    parent_id: frontmatter.id,
    source: document.relativePath,
    source_document: frontmatter.source_document,
    source_document_id: frontmatter.source_document_id,
    source_pages: frontmatter.source_pages ?? [],
    module: frontmatter.module,
    intent: frontmatter.intent,
    source_type: frontmatter.source_type,
    status: frontmatter.status,
    confidence: frontmatter.confidence,
    visibility: frontmatter.visibility,
    headings: document.headings,
    keywords: Array.from(new Set([
      frontmatter.title,
      frontmatter.module,
      frontmatter.intent,
      ...frontmatter.related_terms,
      ...document.headings,
    ].flatMap((item) => keywordsFromQuery(item)))),
    text,
  }];
}

function buildChunkText(document: KnowledgeDocument): string {
  return [
    document.frontmatter.title,
    ...document.frontmatter.related_terms,
    ...document.headings,
    stripMarkdown(document.body),
  ].join('\n').trim();
}

function toEvidenceResult(
  chunk: KnowledgeChunk,
  parent: KnowledgeDocument,
  score: number,
  matchedTerms: string[],
  qualityMap: Map<string, { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] }>,
): KnowledgeEvidenceResult {
  const quality = qualityMap.get(parent.frontmatter.id);
  return {
    evidence_id: `ev_kb_${chunk.chunk_id.replace(/^chk_/, '')}`,
    document_id: parent.frontmatter.id,
    parent_id: parent.frontmatter.id,
    chunk_id: chunk.chunk_id,
    source: parent.relativePath,
    source_document: parent.frontmatter.source_document ?? chunk.source_document,
    source_document_id: parent.frontmatter.source_document_id ?? chunk.source_document_id,
    source_pages: parent.frontmatter.source_pages ?? chunk.source_pages ?? [],
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
    excerpt: excerptFor(parent.body, matchedTerms),
    score,
    quality,
  };
}

async function recallVectorKnowledge(input: {
  input: KnowledgeRagSearchQuery;
  docById: Map<string, KnowledgeDocument>;
  chunkById: Map<string, KnowledgeChunk>;
  queryKeywords: string[];
  normalized: string;
  moduleCandidates: string[];
  intentCandidates: string[];
  qualityMap: Map<string, { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] }>;
  limit: number;
}): Promise<KnowledgeEvidenceResult[]> {
  const provider = input.input.embedding?.provider;
  if (!provider) {
    return [];
  }

  const loaded = readKnowledgeVectorRecords(input.input.workspaceRoot);
  if (loaded.records.length === 0) {
    return [];
  }

  const queryVector = await provider.embedQuery({ text: input.input.query });
  return loaded.records
    .map((record): KnowledgeEvidenceResult | undefined => {
      const chunk = input.chunkById.get(record.chunk_id);
      const parent = input.docById.get(record.document_id);
      if (!chunk || !parent) {
        return undefined;
      }
      if (!passesFilters(parent, input.input, input.moduleCandidates, input.intentCandidates)) {
        return undefined;
      }
      if (parent.frontmatter.status === 'archived' || parent.frontmatter.status === 'deprecated') {
        return undefined;
      }

      const vectorScore = vectorSimilarity(queryVector.vector, record);
      if (vectorScore <= 0) {
        return undefined;
      }
      const keywordScoreInfo = scoreChunk(chunk, parent, input.queryKeywords, input.normalized);
      const score = Number((vectorScore * 100 + keywordScoreInfo.score * 0.25).toFixed(6));
      return {
        ...toEvidenceResult(chunk, parent, score, keywordScoreInfo.matchedTerms, input.qualityMap),
        retrieval: { source: 'vector' as const, vectorScore },
      };
    })
    .filter((item): item is KnowledgeEvidenceResult => item !== undefined)
    .sort((a, b) => (b.retrieval?.vectorScore ?? 0) - (a.retrieval?.vectorScore ?? 0))
    .slice(0, input.limit);
}

function mergeEvidenceResults(
  primary: KnowledgeEvidenceResult[],
  secondary: KnowledgeEvidenceResult[],
): KnowledgeEvidenceResult[] {
  const byKey = new Map<string, KnowledgeEvidenceResult>();
  for (const result of [...primary, ...secondary]) {
    const key = evidenceResultKey(result);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, result);
      continue;
    }
    byKey.set(key, {
      ...existing,
      score: Number(Math.max(existing.score, result.score).toFixed(6)),
      matched_terms: Array.from(new Set([...existing.matched_terms, ...result.matched_terms])).slice(0, 12),
      retrieval: mergeRetrieval(existing.retrieval, result.retrieval),
    });
  }
  return Array.from(byKey.values()).sort((a, b) => b.score - a.score);
}

async function rerankEvidenceResults(
  input: KnowledgeRagSearchQuery,
  results: KnowledgeEvidenceResult[],
  topN: number,
): Promise<KnowledgeEvidenceResult[]> {
  const provider = input.rerank?.provider;
  if (!provider) {
    return results;
  }

  const documents = results.map((result) => ({
    id: evidenceResultKey(result),
    text: evidenceTextForRerank(result),
    metadata: {
      document_id: result.document_id,
      chunk_id: result.chunk_id,
      source: result.source,
      source_type: result.source_type,
      module: result.module,
      intent: result.intent,
    },
  }));
  const reranked = await provider.rerank({ query: input.query, documents, topN });
  const resultById = new Map(results.map((result) => [evidenceResultKey(result), result]));
  const used = new Set<string>();
  const reordered: KnowledgeEvidenceResult[] = [];

  for (const item of reranked.results) {
    const result = resultById.get(item.id);
    if (!result || used.has(item.id)) {
      continue;
    }
    used.add(item.id);
    reordered.push({
      ...result,
      score: Number((result.score + item.score * 100).toFixed(6)),
      retrieval: mergeRetrieval(result.retrieval, { source: 'rerank', rerankScore: item.score }),
    });
  }

  return [
    ...reordered,
    ...results.filter((result) => !used.has(evidenceResultKey(result))).sort((a, b) => b.score - a.score),
  ];
}

function mergeRetrieval(
  left: KnowledgeEvidenceResult['retrieval'],
  right: KnowledgeEvidenceResult['retrieval'],
): KnowledgeEvidenceResult['retrieval'] {
  const keywordScore = right?.keywordScore ?? left?.keywordScore;
  const vectorScore = right?.vectorScore ?? left?.vectorScore;
  const rerankScore = right?.rerankScore ?? left?.rerankScore;
  const source = rerankScore !== undefined
    ? 'rerank'
    : keywordScore !== undefined && vectorScore !== undefined
      ? 'hybrid'
      : vectorScore !== undefined
        ? 'vector'
        : 'keyword';
  return {
    source,
    keywordScore,
    vectorScore,
    rerankScore,
  };
}

function evidenceResultKey(result: KnowledgeEvidenceResult): string {
  return result.chunk_id ?? result.document_id;
}

function evidenceTextForRerank(result: KnowledgeEvidenceResult): string {
  return [
    result.title,
    result.summary,
    result.excerpt,
    result.matched_terms.join(' '),
  ].filter(Boolean).join('\n');
}

function vectorSimilarity(queryVector: number[], record: KnowledgeVectorRecord): number {
  if (queryVector.length === 0 || queryVector.length !== record.vector.length) {
    return 0;
  }
  if (record.distance === 'dot') {
    return dotProduct(queryVector, record.vector);
  }
  if (record.distance === 'euclidean') {
    let squared = 0;
    for (let index = 0; index < queryVector.length; index += 1) {
      const delta = queryVector[index]! - record.vector[index]!;
      squared += delta * delta;
    }
    return 1 / (1 + Math.sqrt(squared));
  }
  const queryNorm = vectorNorm(queryVector);
  const recordNorm = vectorNorm(record.vector);
  if (queryNorm === 0 || recordNorm === 0) {
    return 0;
  }
  return dotProduct(queryVector, record.vector) / (queryNorm * recordNorm);
}

function dotProduct(left: number[], right: number[]): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index]! * right[index]!;
  }
  return score;
}

function vectorNorm(value: number[]): number {
  return Math.sqrt(dotProduct(value, value));
}

function scoreChunk(
  chunk: KnowledgeChunk,
  parent: KnowledgeDocument,
  queryKeywords: string[],
  normalizedQuery: string,
): { score: number; matchedTerms: string[] } {
  const haystack = normalizeText([chunk.text, parent.frontmatter.title, parent.frontmatter.related_terms.join(' ')].join('\n'));
  const matchedTerms = Array.from(new Set(queryKeywords.filter((keyword) => haystack.includes(normalizeText(keyword)))));
  const exactKeywordMatches = chunk.keywords.filter((keyword) => normalizedQuery.includes(normalizeText(keyword)));
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
  if (moduleCandidates.length > 0 && !moduleCandidates.includes(parent.frontmatter.module)) {
    return false;
  }
  if (intentCandidates.length > 0 && !intentCandidates.includes(parent.frontmatter.intent)) {
    return false;
  }
  if (input.sourceTypes?.length && !input.sourceTypes.includes(parent.frontmatter.source_type as KnowledgeSourceType)) {
    return false;
  }
  if (input.visibility?.length && !input.visibility.includes(parent.frontmatter.visibility as KnowledgeVisibility)) {
    return false;
  }
  if (input.productVersions?.length) {
    const docVersions = parent.frontmatter.product_versions;
    if (docVersions.length > 0 && !input.productVersions.some((version) => docVersions.includes(version))) {
      return false;
    }
  }
  return true;
}

function inferModules(queryKeywords: string[], docs: KnowledgeDocument[]): string[] {
  const modules = new Set<string>();
  for (const document of docs) {
    const searchable = normalizeText([
      document.frontmatter.module,
      document.frontmatter.title,
      ...document.frontmatter.related_terms,
    ].join('\n'));
    if (queryKeywords.some((keyword) => searchable.includes(normalizeText(keyword)))) {
      modules.add(document.frontmatter.module);
    }
  }
  return Array.from(modules);
}

function buildKeywordIndex(chunks: KnowledgeChunk[]): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const chunk of chunks) {
    for (const keyword of chunk.keywords) {
      const normalized = normalizeText(keyword);
      if (!normalized) {
        continue;
      }
      index[normalized] = Array.from(new Set([...(index[normalized] ?? []), chunk.chunk_id]));
    }
  }
  return index;
}

function listMarkdownFiles(root: string): string[] {
  return listFiles(root).filter((path) => path.endsWith('.md'));
}

function listFiles(root: string): string[] {
  const entries = readdirSync(root).map((name) => join(root, name));
  return entries.flatMap((entry) => {
    const stat = statSync(entry);
    if (stat.isDirectory()) {
      return listFiles(entry);
    }
    return [entry];
  });
}

function shouldSkipMarkdown(root: string, path: string): boolean {
  const relative = path.slice(root.length + 1).replaceAll('\\', '/');
  return (
    basename(path).toLowerCase() === 'readme.md' ||
    relative.startsWith('_pipeline/') ||
    relative.startsWith('_taxonomy/') ||
    relative.startsWith('_sources/') ||
    relative.startsWith('indexes/') ||
    relative.startsWith('reports/')
  );
}

function extractHeadings(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
    .filter((heading): heading is string => Boolean(heading));
}

function stripMarkdown(body: string): string {
  return body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export function keywordsFromQuery(value: string): string[] {
  const normalized = normalizeText(value);
  const latin = normalized.match(/[a-z0-9_/-]{2,}/g) ?? [];
  const hanRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const hanTerms = hanRuns.flatMap((run) => {
    const terms = new Set<string>([run]);
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
    return Array.from(terms);
  });
  return Array.from(new Set([...latin, ...hanTerms])).filter((item) => item.length >= 2);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?;:：；"'`~\s]/g, '').trim();
}

function excerptFor(body: string, matchedTerms: string[]): string {
  const stripped = stripMarkdown(body).replace(/\s+/g, ' ').trim();
  if (!stripped) {
    return '';
  }
  const firstMatch = matchedTerms
    .map((term) => stripped.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - 80);
  return stripped.slice(start, start + 320);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'chunk';
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
