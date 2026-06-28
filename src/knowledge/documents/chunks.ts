import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chunksPath, dirtyFlagPath } from '../paths.js';
import type { KnowledgeChunk, KnowledgeDocument } from '../types.js';
import { extractKnowledgeTerms } from './terms.js';

export interface KnowledgeChunkingOptions {
  maxChars?: number;
  overlapStrategy?: 'sentence' | 'sliding';
  overlapChars?: number;
  minChars?: number;
}

interface NormalizedChunkingOptions {
  maxChars: number;
  overlapStrategy: 'sentence' | 'sliding';
  overlapChars: number;
  minChars: number;
}

const DEFAULT_CHUNKING_OPTIONS: NormalizedChunkingOptions = {
  maxChars: 800,
  overlapStrategy: 'sentence',
  overlapChars: 120,
  minChars: 80,
};

const CURRENT_CHUNKING_STRATEGY = 'parent-child-v3';
const CURRENT_ARTIFACT_VERSION = 3;

export function loadKnowledgeChunksForSearch(
  workspaceRoot: string,
  documents: KnowledgeDocument[],
  options?: KnowledgeChunkingOptions,
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
  return buildKnowledgeChunks(documents, options);
}

export function buildKnowledgeChunks(
  documents: KnowledgeDocument[],
  options?: KnowledgeChunkingOptions,
): KnowledgeChunk[] {
  const chunking = normalizeChunkingOptions(options);
  return documents.flatMap((document) => chunkDocument(document, chunking));
}

function chunkDocument(document: KnowledgeDocument, options: NormalizedChunkingOptions): KnowledgeChunk[] {
  const frontmatter = document.frontmatter;
  const sections = sectionBlocks(document);
  if (sections.length === 0) {
    return [];
  }
  const drafts = buildSectionChildren(sections, options);
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
      chunking_strategy: CURRENT_CHUNKING_STRATEGY,
      artifact_version: CURRENT_ARTIFACT_VERSION,
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

function buildSectionChildren(blocks: SectionBlock[], options: NormalizedChunkingOptions): ChildDraft[] {
  const bySection = new Map<string, SectionBlock[]>();
  for (const block of blocks) {
    const key = JSON.stringify(block.sectionPath);
    bySection.set(key, [...(bySection.get(key) ?? []), block]);
  }
  return Array.from(bySection.values()).flatMap((section) => packSection(section, options));
}

function packSection(blocks: SectionBlock[], options: NormalizedChunkingOptions): ChildDraft[] {
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
    if (block.text.length > options.maxChars) {
      flush();
      children.push(...splitLongBlock(block, sectionPath, options));
      continue;
    }
    const nextText = [...texts, block.text].join('\n\n');
    if (texts.length > 0 && nextText.length > options.maxChars) {
      const previousSentence = overlapText(texts.at(-1) ?? '', options);
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

function splitLongBlock(
  block: SectionBlock,
  sectionPath: string[],
  options: NormalizedChunkingOptions,
): ChildDraft[] {
  const sentences = splitIntoSentences(block.text);
  if (sentences.length <= 1 || sentences.some((sentence) => sentence.length > options.maxChars)) {
    return [{
      text: block.text,
      sectionPath,
      blockIndexes: [block.blockIndex],
      manualSplitRequired: true,
      overlapChars: 0,
    }];
  }

  const children: ChildDraft[] = [];
  let window: string[] = [];
  let currentOverlapChars = 0;
  const flush = (): void => {
    const text = window.join('').trim();
    if (!text) return;
    children.push({
      text,
      sectionPath,
      blockIndexes: [block.blockIndex],
      manualSplitRequired: false,
      overlapChars: currentOverlapChars,
    });
  };

  for (const sentence of sentences) {
    const candidate = [...window, sentence].join('').trim();
    if (window.length > 0 && candidate.length > options.maxChars) {
      flush();
      const overlap = windowOverlap(window, options);
      window = overlap ? [overlap] : [];
      currentOverlapChars = overlap.length;
    }
    window.push(sentence);
  }
  flush();
  return children;
}

function splitIntoSentences(text: string): string[] {
  return (text.replace(/\r\n/g, '\n').match(/[^。！？!?;；.\n]+(?:[。！？!?;；.]|\n+|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function overlapText(text: string, options: NormalizedChunkingOptions): string | undefined {
  if (options.overlapChars <= 0) return undefined;
  if (options.overlapStrategy === 'sliding') {
    const overlap = text.slice(-options.overlapChars).trim();
    return overlap || undefined;
  }
  const sentence = lastBoundedCompleteSentence(text, options.overlapChars);
  return sentence && sentence.length <= options.overlapChars ? sentence : undefined;
}

function windowOverlap(window: string[], options: NormalizedChunkingOptions): string {
  if (options.overlapChars <= 0 || window.length === 0) return '';
  if (options.overlapStrategy === 'sliding') {
    return window.join('').slice(-options.overlapChars).trim();
  }
  const sentence = window.at(-1)?.trim() ?? '';
  return sentence.length <= options.overlapChars ? sentence : '';
}

function lastBoundedCompleteSentence(text: string, maxChars: number): string | undefined {
  const sentences = text.match(/[^。！？!?;；.]+[。！？!?;；.]/g) ?? [];
  const sentence = sentences.at(-1)?.trim();
  return sentence && sentence.length <= maxChars ? sentence : undefined;
}

function normalizeChunkingOptions(options?: KnowledgeChunkingOptions): NormalizedChunkingOptions {
  const maxChars = positiveInteger(options?.maxChars, DEFAULT_CHUNKING_OPTIONS.maxChars);
  return {
    maxChars,
    overlapStrategy: options?.overlapStrategy === 'sliding' ? 'sliding' : 'sentence',
    overlapChars: Math.min(positiveInteger(options?.overlapChars, DEFAULT_CHUNKING_OPTIONS.overlapChars), maxChars),
    minChars: Math.min(positiveInteger(options?.minChars, DEFAULT_CHUNKING_OPTIONS.minChars), maxChars),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
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
  const current = chunk.artifact_version === CURRENT_ARTIFACT_VERSION
    && chunk.chunking_strategy === CURRENT_CHUNKING_STRATEGY;
  return { ...chunk, legacy: chunk.legacy ?? !current };
}
