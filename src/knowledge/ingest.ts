import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { knowledgeRoot, relativeKnowledgePath } from './paths.js';
import type { KnowledgeIngestReport } from './types.js';

interface ParsedParagraph {
  text: string;
  headingLevel?: number;
}

interface ParentSliceDraft {
  id: string;
  title: string;
  sectionPath: string[];
  body: string;
}

export function defaultSourceDirectory(): string | undefined {
  const path = join(homedir(), 'Documents', 'knowledge');
  return existsSync(path) ? path : undefined;
}

export function ingestSourceDocuments(input: {
  workspaceRoot: string;
  sourceDir?: string;
  force?: boolean;
}): KnowledgeIngestReport {
  const sourceDir = input.sourceDir;
  const report: KnowledgeIngestReport = {
    version: 1,
    sourceDir,
    parserStrategy: 'local-docx-markdown-v1',
    sourceDocuments: 0,
    parentSlices: 0,
    chunks: 0,
    skipped: [],
    imported: [],
    generatedAt: new Date().toISOString(),
  };

  if (!sourceDir || !existsSync(sourceDir)) {
    return report;
  }

  const files = readdirSync(sourceDir)
    .map((name) => join(sourceDir, name))
    .filter((path) => /\.(docx|md|markdown)$/i.test(path));

  for (const sourcePath of files) {
    try {
      const imported = ingestOneSource(input.workspaceRoot, sourcePath, input.force);
      report.sourceDocuments += 1;
      report.parentSlices += imported.parentSliceIds.length;
      report.imported.push(imported);
    } catch (error) {
      report.skipped.push({
        path: sourcePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}

function ingestOneSource(workspaceRoot: string, sourcePath: string, force?: boolean): KnowledgeIngestReport['imported'][number] {
  const ext = extname(sourcePath).toLowerCase();
  const hash = sha256(sourcePath);
  const sourceDocumentId = `src_whitepaper_${hash.slice(0, 12)}`;
  const originalName = basename(sourcePath);
  const sourceRoot = join(knowledgeRoot(workspaceRoot), '_sources', 'whitepapers');
  mkdirSync(sourceRoot, { recursive: true });
  const targetSource = join(sourceRoot, originalName);
  if (force || !existsSync(targetSource)) {
    copyFileSync(sourcePath, targetSource);
  }

  const paragraphs = ext === '.docx' ? parseDocx(sourcePath) : parseMarkdownSource(sourcePath);
  const title = inferTitle(paragraphs, originalName);
  const module = inferModule(`${originalName}\n${paragraphs.slice(0, 12).map((item) => item.text).join('\n')}`);
  const slices = buildParentSlices({
    sourceDocumentId,
    module,
    sourceTitle: title,
    paragraphs,
  });
  const sourceDocumentPath = relativeKnowledgePath(workspaceRoot, targetSource);

  writeFileSync(
    `${targetSource}.meta.json`,
    `${JSON.stringify({
      id: sourceDocumentId,
      source_type: ext === '.docx' ? 'whitepaper_docx' : 'whitepaper_markdown',
      path: sourceDocumentPath,
      sha256: hash,
      title,
      downloaded_at: new Date().toISOString(),
      product_versions: [],
      page_count: null,
      owner: 'knowledge-admin',
      ingest_tool_version: 'local-docx-markdown-v1',
    }, null, 2)}\n`,
    'utf8',
  );

  const sourceSlug = safeSlug(title || originalName || sourceDocumentId);
  const sliceDir = join(knowledgeRoot(workspaceRoot), 'whitepapers', module, sourceSlug);
  mkdirSync(sliceDir, { recursive: true });
  const parentSliceIds: string[] = [];
  for (const [index, slice] of slices.entries()) {
    const path = join(sliceDir, `${String(index + 1).padStart(3, '0')}-${safeSlug(slice.title)}.md`);
    const content = renderWhitepaperSlice({
      ...slice,
      module,
      sourceDocument: sourceDocumentPath,
      sourceDocumentId,
      sourceTitle: title,
    });
    if (force || !existsSync(path)) {
      writeFileSync(path, content, 'utf8');
      parentSliceIds.push(slice.id);
    } else {
      parentSliceIds.push(existingDocumentId(path) ?? slice.id);
    }
  }

  return {
    sourcePath,
    sourceDocumentId,
    sourceDocumentPath,
    parentSliceIds,
  };
}

function parseDocx(path: string): ParsedParagraph[] {
  const documentXml = unzipText(path, 'word/document.xml');
  const styleMap = parseDocxStyles(path);
  const paragraphs: ParsedParagraph[] = [];
  for (const match of documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const block = match[0];
    const text = Array.from(block.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
      .map((textMatch) => decodeXml(textMatch[1] ?? ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      continue;
    }
    const styleId = block.match(/<w:pStyle\s+w:val="([^"]+)"/)?.[1];
    const styleName = styleId ? styleMap.get(styleId) : undefined;
    if (styleName?.startsWith('toc')) {
      continue;
    }
    paragraphs.push({
      text,
      headingLevel: headingLevel(styleId, styleName),
    });
  }
  return paragraphs;
}

function parseDocxStyles(path: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const stylesXml = unzipText(path, 'word/styles.xml');
    for (const match of stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)) {
      const block = match[0];
      const id = block.match(/w:styleId="([^"]+)"/)?.[1];
      const name = block.match(/<w:name\s+w:val="([^"]+)"/)?.[1];
      if (id && name) {
        map.set(id, name.toLowerCase());
      }
    }
  } catch {
    return map;
  }
  return map;
}

function parseMarkdownSource(path: string): ParsedParagraph[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      return {
        text: (heading?.[2] ?? line).trim(),
        headingLevel: heading ? heading[1]!.length : undefined,
      };
    })
    .filter((item) => item.text);
}

function buildParentSlices(input: {
  sourceDocumentId: string;
  module: string;
  sourceTitle: string;
  paragraphs: ParsedParagraph[];
}): ParentSliceDraft[] {
  const slices: ParentSliceDraft[] = [];
  let currentTitle = input.sourceTitle;
  let currentPath = [input.sourceTitle];
  let currentLines: string[] = [];

  const flush = (): void => {
    const body = currentLines.join('\n\n').trim();
    if (!body) {
      return;
    }
    const id = `kb_whitepaper_${input.module}_${safeSlug(input.sourceDocumentId)}_${String(slices.length + 1).padStart(3, '0')}`;
    slices.push({
      id,
      title: currentTitle,
      sectionPath: currentPath,
      body,
    });
    currentLines = [];
  };

  for (const paragraph of input.paragraphs) {
    if (paragraph.headingLevel && paragraph.headingLevel <= 3) {
      if (currentLines.length > 0) {
        flush();
      }
      currentTitle = paragraph.text;
      currentPath = paragraph.headingLevel === 1
        ? [paragraph.text]
        : [...currentPath.slice(0, Math.max(1, paragraph.headingLevel - 1)), paragraph.text];
      currentLines.push(`${'#'.repeat(Math.min(paragraph.headingLevel + 1, 4))} ${paragraph.text}`);
      continue;
    }
    currentLines.push(paragraph.text);
    if (currentLines.join('\n').length > 2800) {
      flush();
    }
  }
  flush();

  if (slices.length === 0 && input.paragraphs.length > 0) {
    slices.push({
      id: `kb_whitepaper_${input.module}_${safeSlug(input.sourceDocumentId)}_001`,
      title: input.sourceTitle,
      sectionPath: [input.sourceTitle],
      body: input.paragraphs.map((item) => item.text).join('\n\n'),
    });
  }

  return slices;
}

function renderWhitepaperSlice(input: ParentSliceDraft & {
  module: string;
  sourceDocument: string;
  sourceDocumentId: string;
  sourceTitle: string;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const relatedTerms = Array.from(new Set([input.title, ...input.sectionPath, ...input.sourceTitle.split(/\s+/)].filter(Boolean))).slice(0, 12);
  return `---
id: ${input.id}
title: ${yamlScalar(input.title)}
type: whitepaper_slice
module: ${input.module}
intent: product_rule
source_type: whitepaper
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms:
${yamlArray(relatedTerms)}
related_repos: []
last_verified_at: ${today}
owner: knowledge-admin
source_document: ${input.sourceDocument}
source_document_id: ${input.sourceDocumentId}
source_pages: []
section_path:
${yamlArray(input.sectionPath)}
chunking_strategy: semantic-section-v1
---

# ${input.title}

## 可回答的问题

- 与“${input.title}”相关的产品规则、功能说明和操作条件。

## 核心内容

${input.body}

## 原文来源

- 原始文件：${input.sourceDocument}
- 章节路径：${input.sectionPath.join(' > ')}
`;
}

function inferTitle(paragraphs: ParsedParagraph[], fallback: string): string {
  return paragraphs.find((item) => item.headingLevel)?.text ?? paragraphs.find((item) => item.text.length >= 4)?.text ?? fallback.replace(/\.[^.]+$/, '');
}

function inferModule(text: string): string {
  if (/AI伴学|伴学助手|学习计划|督学提醒|题目答疑/.test(text)) {
    return 'ai-companion';
  }
  if (/EduSoho|教培|课程|班级|学员|教师|网校/.test(text)) {
    return 'edusoho-training';
  }
  return 'general';
}

function unzipText(path: string, entry: string): string {
  const result = spawnSync('unzip', ['-p', path, entry], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`failed to read ${entry} from ${basename(path)}`);
  }
  return result.stdout;
}

function headingLevel(styleId?: string, styleName?: string): number | undefined {
  const nameLevel = styleName?.match(/heading\s+([1-6])/i)?.[1];
  if (nameLevel) {
    return Number(nameLevel);
  }
  const numeric = Number(styleId);
  if (Number.isInteger(numeric) && numeric >= 2 && numeric <= 7) {
    return numeric - 1;
  }
  return undefined;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function safeSlug(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function yamlArray(values: string[]): string {
  if (values.length === 0) {
    return '  []';
  }
  return values.map((value) => `  - ${yamlScalar(value)}`).join('\n');
}

function yamlScalar(value: string): string {
  return /[:#\[\]{},"']|\s$|^\s/.test(value) ? JSON.stringify(value) : value;
}

function existingDocumentId(path: string): string | undefined {
  const content = readFileSync(path, 'utf8');
  return content.match(/^id:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}
