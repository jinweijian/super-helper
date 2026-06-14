import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceBlocksPath, sourceExtractReportPath, sourceNormalizeReportPath } from './paths.js';
import type {
  KnowledgeExtractReport,
  KnowledgeNormalizedBlock,
  KnowledgeNormalizeReport,
  KnowledgeSourceBlock,
  KnowledgeSourceBlockType,
} from './types.js';

const DOCX_PARSER = 'local-docx-v1';
const MARKDOWN_PARSER = 'local-markdown-v1';
const UNKNOWN_RATIO_THRESHOLD = 0.3;

interface ParsedDocxBlock {
  text: string;
  headingLevel?: number;
  styleName?: string;
  isListItem: boolean;
  raw: string;
}

export function extractSourceBlocks(input: {
  workspaceRoot: string;
  sourceDocumentId: string;
  sourcePath: string;
}): { blocks: KnowledgeSourceBlock[]; report: KnowledgeExtractReport } {
  const ext = extname(input.sourcePath).toLowerCase();
  let raw: ParsedDocxBlock[];
  let parser: string;
  if (ext === '.docx') {
    raw = parseDocx(input.sourcePath);
    parser = DOCX_PARSER;
  } else if (ext === '.md' || ext === '.markdown') {
    raw = parseMarkdownSource(input.sourcePath);
    parser = MARKDOWN_PARSER;
  } else {
    raw = [];
    parser = 'unsupported';
  }

  const blocks = raw.map((item, index) => buildSourceBlock(item, index, input.sourceDocumentId));
  const report = buildExtractReport(input.sourceDocumentId, blocks, parser, ext, ext === '.docx' && hasDocxTables(input.sourcePath));
  writeExtractArtifacts(input.workspaceRoot, blocks, report);
  return { blocks, report };
}

function buildSourceBlock(item: ParsedDocxBlock, index: number, sourceDocumentId: string): KnowledgeSourceBlock {
  const type = inferBlockType(item);
  const sectionPath = item.headingLevel ? [item.text] : [];
  return {
    block_id: `blk_${sourceDocumentId}_${String(index + 1).padStart(5, '0')}`,
    source_document_id: sourceDocumentId,
    order: index + 1,
    type,
    text: item.text,
    heading_level: item.headingLevel,
    section_path: sectionPath,
    raw: item.raw,
    parser: undefined,
  };
}

function inferBlockType(item: ParsedDocxBlock): KnowledgeSourceBlockType {
  if (item.headingLevel) {
    return 'heading';
  }
  if (item.isListItem) {
    return 'list_item';
  }
  if (item.styleName && /toc|table[ -]of[ -]contents|目录/i.test(item.styleName)) {
    return 'toc';
  }
  if (item.styleName && /header|footer|页眉|页脚/i.test(item.styleName)) {
    return 'header_footer';
  }
  if (item.styleName && /caption|图说|图片说明/i.test(item.styleName)) {
    return 'image_caption';
  }
  return 'paragraph';
}

function buildExtractReport(
  sourceDocumentId: string,
  blocks: KnowledgeSourceBlock[],
  parser: string,
  ext: string,
  hasTables: boolean,
): KnowledgeExtractReport {
  const blockCounts: Record<string, number> = {};
  for (const block of blocks) {
    blockCounts[block.type] = (blockCounts[block.type] ?? 0) + 1;
  }
  const unknownBlockCount = blockCounts['unknown'] ?? 0;
  const skippedTocCount = blockCounts['toc'] ?? 0;
  const warnings: string[] = [];
  if (blocks.length === 0) {
    warnings.push(`No blocks extracted from ${ext || 'unknown'} file.`);
  }
  if (blocks.length > 0 && unknownBlockCount / blocks.length > UNKNOWN_RATIO_THRESHOLD) {
    warnings.push(`Unknown block ratio (${unknownBlockCount}/${blocks.length}) exceeds ${UNKNOWN_RATIO_THRESHOLD}.`);
  }
  if (ext === '.docx' && hasTables) {
    warnings.push('table_lost: DOCX table structure not preserved in this extractor; table cells appear as paragraphs.');
  }
  return {
    version: 1,
    sourceDocumentId,
    generatedAt: new Date().toISOString(),
    parserStrategy: parser,
    blockCounts,
    unknownBlockCount,
    skippedTocCount,
    warnings,
    errors: [],
    fatal: blocks.length === 0,
  };
}

function hasDocxTables(path: string): boolean {
  try {
    return /<w:tbl[\s>]/.test(unzipText(path, 'word/document.xml'));
  } catch {
    return false;
  }
}

function writeExtractArtifacts(workspaceRoot: string, blocks: KnowledgeSourceBlock[], report: KnowledgeExtractReport): void {
  const dir = join(workspaceRoot, 'knowledge', '_pipeline', 'extracts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    sourceBlocksPath(workspaceRoot, report.sourceDocumentId),
    blocks.map((b) => JSON.stringify(b)).join('\n') + (blocks.length ? '\n' : ''),
    'utf8',
  );
  writeFileSync(sourceExtractReportPath(workspaceRoot, report.sourceDocumentId), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

// DOCX parsing
function parseDocx(path: string): ParsedDocxBlock[] {
  const documentXml = unzipText(path, 'word/document.xml');
  const styleMap = parseDocxStyles(path);
  const blocks: ParsedDocxBlock[] = [];
  for (const match of documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const block = match[0];
    const text = Array.from(block.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
      .map((m) => decodeXml(m[1] ?? ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      continue;
    }
    const styleId = block.match(/<w:pStyle\s+w:val="([^"]+)"/)?.[1];
    const styleName = styleId ? styleMap.get(styleId) : undefined;
    const headingLevel = resolveHeadingLevel(styleId, styleName);
    const isListItem = !headingLevel && (styleName?.includes('list') || /^\s*[\d、〇•\-\*]/.test(text));
    blocks.push({ text, headingLevel, styleName, isListItem, raw: block });
  }
  return blocks;
}

function parseDocxStyles(path: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const stylesXml = unzipText(path, 'word/styles.xml');
    for (const match of stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)) {
      const id = match[0].match(/w:styleId="([^"]+)"/)?.[1];
      const name = match[0].match(/<w:name\s+w:val="([^"]+)"/)?.[1];
      if (id && name) {
        map.set(id, name.toLowerCase());
      }
    }
  } catch {
    return map;
  }
  return map;
}

function resolveHeadingLevel(styleId?: string, styleName?: string): number | undefined {
  const nameLevel = styleName?.match(/heading\s+([1-6])/i)?.[1];
  if (nameLevel) {
    return Number(nameLevel);
  }
  if (styleName?.match(/标题\s*([1-6])/)?.[1]) {
    return Number(styleName.match(/标题\s*([1-6])/)?.[1]);
  }
  const numeric = Number(styleId);
  if (Number.isInteger(numeric) && numeric >= 2 && numeric <= 7) {
    return numeric - 1;
  }
  return undefined;
}

function parseMarkdownSource(path: string): ParsedDocxBlock[] {
  const result: ParsedDocxBlock[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const text = (heading?.[2] ?? line).trim();
    if (!text) {
      continue;
    }
    result.push({
      text,
      headingLevel: heading ? heading[1]!.length : undefined,
      styleName: heading ? `heading ${heading[1]!.length}` : undefined,
      isListItem: /^[\s]*[-*+\d]+\.?\s+/.test(line),
      raw: line,
    });
  }
  return result;
}

function unzipText(path: string, entry: string): string {
  const result = spawnSync('unzip', ['-p', path, entry], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`failed to read ${entry} from ${basename(path)}`);
  }
  return result.stdout;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Normalization
export function normalizeSourceBlocks(input: {
  workspaceRoot: string;
  sourceDocumentId: string;
  blocks: KnowledgeSourceBlock[];
}): { blocks: KnowledgeNormalizedBlock[]; report: KnowledgeNormalizeReport } {
  const headingPath: string[] = [];
  const normalized: KnowledgeNormalizedBlock[] = [];
  const excludedCounts: Record<string, number> = {};
  const headingStructureWarnings: string[] = [];
  const titleRepetitions = detectTitleRepetitions(input.blocks);
  const footerRepetitions = detectHeaderFooterRepetitions(input.blocks);

  for (const block of input.blocks) {
    if (block.type === 'heading' && block.heading_level) {
      while (headingPath.length >= block.heading_level) {
        headingPath.pop();
      }
      headingPath.push(block.text);
    }
    const sectionPath = block.heading_level ? headingPath.slice(0, block.heading_level) : headingPath.slice();
    const isExcluded =
      block.type === 'toc' ||
      block.type === 'header_footer' ||
      (block.type === 'heading' && titleRepetitions.has(block.text)) ||
      (block.type === 'paragraph' && footerRepetitions.has(block.text));

    let excludedReason: string | undefined;
    if (block.type === 'toc') {
      excludedReason = 'toc_block';
      excludedCounts['toc'] = (excludedCounts['toc'] ?? 0) + 1;
    } else if (block.type === 'header_footer') {
      excludedReason = 'header_footer';
      excludedCounts['header_footer'] = (excludedCounts['header_footer'] ?? 0) + 1;
    } else if (block.type === 'heading' && titleRepetitions.has(block.text)) {
      excludedReason = 'repeated_title';
      excludedCounts['repeated_title'] = (excludedCounts['repeated_title'] ?? 0) + 1;
    } else if (block.type === 'paragraph' && footerRepetitions.has(block.text)) {
      excludedReason = 'repeated_footer';
      excludedCounts['repeated_footer'] = (excludedCounts['repeated_footer'] ?? 0) + 1;
    }

    const normalizedText = isExcluded ? '' : cleanText(block.text);

    if (block.type === 'heading' && !block.heading_level) {
      headingStructureWarnings.push(`Heading block without heading_level: ${block.text.slice(0, 40)}`);
    }

    normalized.push({
      block_id: `nrm_${input.sourceDocumentId}_${String(block.order).padStart(5, '0')}`,
      source_document_id: input.sourceDocumentId,
      source_block_id: block.block_id,
      order: block.order,
      type: block.type,
      text: block.text,
      normalized_text: normalizedText,
      section_path: sectionPath,
      included_in_slice: !isExcluded,
      excluded_reason: excludedReason,
    });
  }

  if (headingPath.length === 0 && normalized.some((b) => b.type === 'paragraph')) {
    headingStructureWarnings.push('No heading blocks detected; section_path will be empty for all slices.');
  }

  const report: KnowledgeNormalizeReport = {
    version: 1,
    sourceDocumentId: input.sourceDocumentId,
    inputBlockCount: input.blocks.length,
    outputBlockCount: normalized.length,
    excludedBlockCounts: excludedCounts,
    headingStructureWarnings,
    generatedAt: new Date().toISOString(),
  };

  writeNormalizeArtifacts(input.workspaceRoot, normalized, report);
  return { blocks: normalized, report };
}

function writeNormalizeArtifacts(workspaceRoot: string, blocks: KnowledgeNormalizedBlock[], report: KnowledgeNormalizeReport): void {
  const dir = join(workspaceRoot, 'knowledge', '_pipeline', 'normalized');
  mkdirSync(dir, { recursive: true });
  writeFileSync(sourceNormalizeReportPath(workspaceRoot, report.sourceDocumentId), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // The blocks path keeps .blocks.jsonl for downstream tools.
  const blocksPath = sourceNormalizeReportPath(workspaceRoot, report.sourceDocumentId).replace(/\.normalize-report\.json$/, '.blocks.jsonl');
  writeFileSync(blocksPath, blocks.map((b) => JSON.stringify(b)).join('\n') + (blocks.length ? '\n' : ''), 'utf8');
}

function cleanText(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectTitleRepetitions(blocks: KnowledgeSourceBlock[]): Set<string> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (block.type === 'heading' && block.text.length < 60) {
      counts.set(block.text, (counts.get(block.text) ?? 0) + 1);
    }
  }
  const repeats = new Set<string>();
  for (const [text, count] of counts) {
    if (count >= 3) {
      repeats.add(text);
    }
  }
  return repeats;
}

function detectHeaderFooterRepetitions(blocks: KnowledgeSourceBlock[]): Set<string> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    if (block.type === 'paragraph' && block.text.length < 80) {
      counts.set(block.text, (counts.get(block.text) ?? 0) + 1);
    }
  }
  const repeats = new Set<string>();
  for (const [text, count] of counts) {
    if (count >= 4) {
      repeats.add(text);
    }
  }
  return repeats;
}

export function readSourceBlocks(workspaceRoot: string, sourceDocumentId: string): KnowledgeSourceBlock[] {
  const path = sourceBlocksPath(workspaceRoot, sourceDocumentId);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as KnowledgeSourceBlock];
      } catch {
        return [];
      }
    });
}

export function readNormalizedBlocks(workspaceRoot: string, sourceDocumentId: string): KnowledgeNormalizedBlock[] {
  const path = sourceNormalizeReportPath(workspaceRoot, sourceDocumentId).replace(/\.normalize-report\.json$/, '.blocks.jsonl');
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as KnowledgeNormalizedBlock];
      } catch {
        return [];
      }
    });
}

export function hashSourceDocument(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
