import { createHash } from 'node:crypto';
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
          return [markLegacyChunk(JSON.parse(line) as KnowledgeChunk)];
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
  const sections = sectionBlocks(document);
  if (sections.length === 0) {
    return [];
  }
  const drafts = buildSectionChildren(sections);
  return drafts.map((draft, index) => {
    const childOrder = index + 1;
    const sourceBlockIds = sourceBlocksForChild(frontmatter.source_block_ids ?? [], draft.blockIndexes);
    const textHash = createHash('sha256').update(JSON.stringify({
      text: draft.text,
      sectionPath: draft.sectionPath,
      sourceBlockIds,
      childOrder,
    })).digest('hex');
    return {
      chunk_id: `chk_${slug(frontmatter.id)}_${String(childOrder).padStart(3, '0')}`,
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
      headings: draft.sectionPath,
      keywords: Array.from(new Set([
        frontmatter.title,
        frontmatter.module,
        frontmatter.intent,
        ...frontmatter.related_terms,
        ...draft.sectionPath,
      ].flatMap((item) => extractKnowledgeTerms(item)))),
      text: draft.text,
      child_order: childOrder,
      source_block_ids: sourceBlockIds,
      section_path: draft.sectionPath,
      text_hash: textHash,
      parent_title: frontmatter.title,
      parent_terms: [...frontmatter.related_terms],
      quality_status: frontmatter.quality_status,
      chunking_strategy: 'parent-child-v2',
      artifact_version: 2,
      legacy: false,
      manual_split_required: draft.manualSplitRequired || undefined,
      overlap_chars: draft.overlapChars || undefined,
    } satisfies KnowledgeChunk;
  });
}

interface SectionBlock {
  text: string;
  sectionPath: string[];
  blockIndex: number;
}

interface ChildDraft {
  text: string;
  sectionPath: string[];
  blockIndexes: number[];
  manualSplitRequired: boolean;
  overlapChars: number;
}

function sectionBlocks(document: KnowledgeDocument): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  const headingStack: string[] = [];
  const lines: string[] = [];
  let blockIndex = 0;

  const currentPath = (): string[] => {
    const configured = document.frontmatter.section_path ?? [];
    const headings = headingStack.filter((heading) => heading !== document.frontmatter.title);
    const path = Array.from(new Set([...configured, ...headings]));
    return path.length > 0 ? path : [document.frontmatter.title];
  };
  const flush = (): void => {
    const text = stripMarkdown(lines.join('\n')).trim();
    lines.length = 0;
    if (!text) return;
    blocks.push({ text, sectionPath: currentPath(), blockIndex });
    blockIndex += 1;
  };

  for (const rawLine of document.body.split(/\r?\n/)) {
    const heading = rawLine.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = heading[2]!.trim();
      continue;
    }
    if (!rawLine.trim()) {
      flush();
      continue;
    }
    lines.push(rawLine);
  }
  flush();
  return blocks;
}

function buildSectionChildren(blocks: SectionBlock[]): ChildDraft[] {
  const bySection = new Map<string, SectionBlock[]>();
  for (const block of blocks) {
    const key = JSON.stringify(block.sectionPath);
    bySection.set(key, [...(bySection.get(key) ?? []), block]);
  }
  return Array.from(bySection.values()).flatMap((section) => packSection(section));
}

function packSection(blocks: SectionBlock[]): ChildDraft[] {
  const children: ChildDraft[] = [];
  let texts: string[] = [];
  let indexes: number[] = [];
  let overlapChars = 0;
  const sectionPath = blocks[0]?.sectionPath ?? [];
  const flush = (manualSplitRequired = false): void => {
    const text = texts.join('\n\n').trim();
    if (!text) return;
    children.push({ text, sectionPath, blockIndexes: [...indexes], manualSplitRequired, overlapChars });
    texts = [];
    indexes = [];
    overlapChars = 0;
  };

  for (const block of blocks) {
    if (block.text.length > 800) {
      flush();
      texts = [block.text];
      indexes = [block.blockIndex];
      flush(true);
      continue;
    }
    const nextText = [...texts, block.text].join('\n\n');
    if (texts.length > 0 && nextText.length > 800) {
      const previousSentence = lastCompleteSentence(texts.at(-1) ?? '');
      flush();
      if (previousSentence) {
        texts = [previousSentence];
        overlapChars = previousSentence.length;
      }
    }
    texts.push(block.text);
    indexes.push(block.blockIndex);
  }
  flush();
  return children;
}

function lastCompleteSentence(text: string): string | undefined {
  const sentences = text.match(/[^。！？!?]+[。！？!?]/g) ?? [];
  const sentence = sentences.at(-1)?.trim();
  return sentence && sentence.length <= 120 ? sentence : undefined;
}

function sourceBlocksForChild(sourceBlockIds: string[], blockIndexes: number[]): string[] {
  if (sourceBlockIds.length === 0) return [];
  // Parent Markdown 没有保留无损的 block-to-paragraph 标记；保留完整父级溯源，
  // 避免猜测一个看似更精确、实际无法证明的子集。
  void blockIndexes;
  return Array.from(new Set(sourceBlockIds));
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

export function markLegacyChunk(chunk: KnowledgeChunk): KnowledgeChunk {
  const v2 = chunk.artifact_version === 2 && chunk.chunking_strategy === 'parent-child-v2';
  return { ...chunk, legacy: chunk.legacy ?? !v2 };
}
