import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseMarkdownDocument } from './frontmatter.js';
import { chunksPath, dirtyFlagPath, keywordIndexPath, knowledgeRoot, manifestPath, relativeKnowledgePath } from './paths.js';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeEvidencePack,
  KnowledgeEvidenceResult,
  KnowledgeIndexManifest,
  KnowledgeSearchQuery,
  KnowledgeSourceDocument,
  KnowledgeSourceType,
  KnowledgeUpdateResult,
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

export function searchKnowledge(input: KnowledgeSearchQuery): KnowledgeEvidencePack {
  const docs = discoverKnowledgeDocuments(input.workspaceRoot);
  const docById = new Map(docs.map((document) => [document.frontmatter.id, document]));
  const chunks = loadChunks(input.workspaceRoot, docs);
  const normalized = normalizeText(input.query);
  const queryKeywords = keywordsFromQuery(input.query);
  const moduleCandidates = input.moduleCandidates?.length ? input.moduleCandidates : inferModules(queryKeywords, docs);
  const intentCandidates = input.intentCandidates ?? [];
  const filteredOut = new Map<string, number>();

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
      return toEvidenceResult(chunk, parent, scoreInfo.score, scoreInfo.matchedTerms);
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
): KnowledgeEvidenceResult {
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
  };
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
    relative.startsWith('_taxonomy/') ||
    relative.startsWith('_sources/') ||
    relative.startsWith('indexes/')
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
