import { existsSync, readFileSync } from 'node:fs';
import { chunksPath, dirtyFlagPath } from '../paths.js';
import type { KnowledgeChunk, KnowledgeDocument } from '../types.js';
import { extractKnowledgeTerms } from './terms.js';

export function loadKnowledgeChunksForSearch(
  workspaceRoot: string,
  documents: KnowledgeDocument[],
): KnowledgeChunk[] {
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
  return buildKnowledgeChunks(documents);
}

export function buildKnowledgeChunks(documents: KnowledgeDocument[]): KnowledgeChunk[] {
  return documents.flatMap((document) => chunkDocument(document));
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
    ].flatMap((item) => extractKnowledgeTerms(item)))),
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

function stripMarkdown(body: string): string {
  return body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'chunk';
}
