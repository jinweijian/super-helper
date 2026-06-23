import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceDraftReportPath, sourceDraftRoot } from './paths.js';
import type {
  KnowledgeDraftSliceReport,
  KnowledgeNormalizedBlock,
  KnowledgePipelineStage,
  KnowledgePipelineStatus,
  KnowledgeStatus,
} from './types.js';

const DEFAULT_MAX_PARENT_CHARS = 2800;
const DEFAULT_MIN_BODY_CHARS = 80;

export interface BuildDraftSlicesInput {
  workspaceRoot: string;
  sourceDocumentId: string;
  sourceTitle: string;
  sourceKind: string;
  sourceDocumentPath?: string;
  normalizedBlocks: KnowledgeNormalizedBlock[];
  maxParentChars?: number;
  minBodyChars?: number;
}

export interface BuildDraftSlicesResult {
  draftIds: string[];
  report: KnowledgeDraftSliceReport;
  draftPaths: string[];
}

export function buildDraftSlices(input: BuildDraftSlicesInput): BuildDraftSlicesResult {
  const maxChars = input.maxParentChars ?? DEFAULT_MAX_PARENT_CHARS;
  const minChars = input.minBodyChars ?? DEFAULT_MIN_BODY_CHARS;
  const included = input.normalizedBlocks.filter((b) => b.included_in_slice);
  const groups = groupBlocksByHeading(included);
  const draftRoot = sourceDraftRoot(input.workspaceRoot, input.sourceDocumentId);
  mkdirSync(draftRoot, { recursive: true });

  const draftIds: string[] = [];
  const draftPaths: string[] = [];
  const warnings: string[] = [];
  const moduleInferred = inferModule(input.sourceTitle, included.map((b) => b.text).join('\n'));
  let sliceIndex = 0;
  const coveredBlockIds = new Set<string>();

  for (const group of groups) {
    const splitGroups = splitBlockGroupIntoDraftGroups(group, maxChars, warnings);
    for (let partIndex = 0; partIndex < splitGroups.length; partIndex += 1) {
      const splitGroup = splitGroups[partIndex]!;
      const sliceBody = renderBody(splitGroup.blocks, minChars, warnings);
      if (!sliceBody.trim()) {
        continue;
      }
      sliceIndex += 1;
      const sliceId = `drf_${input.sourceDocumentId}_${String(sliceIndex).padStart(3, '0')}`;
      const slug = safeSlug(group.title || input.sourceTitle);
      const partSuffix = splitGroups.length > 1 ? `-part-${partIndex + 1}` : '';
      const path = join(draftRoot, `${String(sliceIndex).padStart(3, '0')}-${slug}${partSuffix}.md`);
      const firstBlockId = splitGroup.blocks[0]?.source_block_id;
      const lastBlockId = splitGroup.blocks[splitGroup.blocks.length - 1]?.source_block_id;
      const sourceBlockIds = splitGroup.blocks.map((b) => b.source_block_id);
      sourceBlockIds.forEach((id) => coveredBlockIds.add(id));
      const title = splitGroups.length > 1
        ? `${group.title || input.sourceTitle} 第 ${partIndex + 1} 部分`
        : group.title || input.sourceTitle;

      const content = renderDraftSlice({
        id: sliceId,
        title,
        module: moduleInferred,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentPath: input.sourceDocumentPath,
        sourceTitle: input.sourceTitle,
        sectionPath: group.sectionPath,
        sourceBlockIds,
        body: sliceBody,
        firstBlockId,
        lastBlockId,
      });

      writeFileSync(path, content, 'utf8');
      draftIds.push(sliceId);
      draftPaths.push(path);
    }
  }

  if (draftIds.length === 0) {
    warnings.push('No draft slices generated; consider widening input or relaxing boilerplate detection.');
  }

  const includedCount = included.length;
  const includedBlockIds = included.map((block) => block.source_block_id);
  const uncoveredBlockIds = includedBlockIds.filter((id) => !coveredBlockIds.has(id));

  const report: KnowledgeDraftSliceReport = {
    version: 1,
    sourceDocumentId: input.sourceDocumentId,
    draftSliceCount: draftIds.length,
    draftPaths,
    sourceBlockCoverage: { included: includedCount, total: coveredBlockIds.size },
    coveredSourceBlockIds: Array.from(coveredBlockIds),
    uncoveredSourceBlockIds: uncoveredBlockIds,
    warnings,
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(sourceDraftReportPath(input.workspaceRoot, input.sourceDocumentId), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { draftIds, report, draftPaths };
}

export interface BlockGroup {
  title: string;
  sectionPath: string[];
  blocks: KnowledgeNormalizedBlock[];
}

function groupBlocksByHeading(blocks: KnowledgeNormalizedBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  let current: BlockGroup = { title: '', sectionPath: [], blocks: [] };

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (current.blocks.length > 0) {
        groups.push(current);
      }
      current = {
        title: block.text,
        sectionPath: block.section_path.length > 0 ? block.section_path : [block.text],
        blocks: [block],
      };
    } else {
      current.blocks.push(block);
    }
  }
  if (current.blocks.length > 0) {
    groups.push(current);
  }
  if (groups.length === 0 && blocks.length > 0) {
    groups.push({ title: '', sectionPath: [], blocks });
  }
  return groups;
}

export function splitBlockGroupIntoDraftGroups(group: BlockGroup, maxChars: number, warnings: string[] = []): BlockGroup[] {
  const totalLength = group.blocks.reduce((sum, block) => sum + blockText(block).length, 0);
  if (totalLength <= maxChars) {
    return [group];
  }

  const result: BlockGroup[] = [];
  let current: KnowledgeNormalizedBlock[] = [];
  let currentLength = 0;

  const pushCurrent = (): void => {
    if (current.length === 0) {
      return;
    }
    result.push({ title: group.title, sectionPath: group.sectionPath, blocks: current });
    current = [];
    currentLength = 0;
  };

  for (const block of group.blocks) {
    const textLength = blockText(block).length;
    if (textLength > maxChars && current.length === 0) {
      result.push({ title: group.title, sectionPath: group.sectionPath, blocks: [block] });
      warnings.push(`manual_split_required: ${block.source_block_id} exceeds maxParentChars=${maxChars}.`);
      continue;
    }

    const currentHasBody = current.some((item) => item.type !== 'heading');
    if (textLength > maxChars && current.length > 0 && !currentHasBody) {
      current.push(block);
      currentLength += textLength;
      warnings.push(`manual_split_required: ${block.source_block_id} exceeds maxParentChars=${maxChars}.`);
      pushCurrent();
      continue;
    }
    if (current.length > 0 && currentHasBody && currentLength + textLength > maxChars) {
      pushCurrent();
    }

    current.push(block);
    currentLength += textLength;
  }

  pushCurrent();
  return result.length > 0 ? result : [group];
}

function blockText(block: KnowledgeNormalizedBlock): string {
  return (block.normalized_text || block.text || '').trim();
}

function renderBody(blocks: KnowledgeNormalizedBlock[], minChars: number, warnings: string[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      lines.push(`### ${block.text}`);
      continue;
    }
    const text = blockText(block);
    lines.push(text);
  }
  const body = lines.join('\n\n').trim();
  if (body.length < minChars) {
    warnings.push(`Generated slice body length (${body.length}) below min (${minChars}).`);
  }
  return body;
}

function renderDraftSlice(input: {
  id: string;
  title: string;
  module: string;
  sourceDocumentId: string;
  sourceDocumentPath?: string;
  sourceTitle: string;
  sectionPath: string[];
  sourceBlockIds: string[];
  body: string;
  firstBlockId?: string;
  lastBlockId?: string;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  const relatedTerms = Array.from(new Set([input.title, ...input.sectionPath, input.sourceTitle].filter(Boolean))).slice(0, 12);
  const stage: KnowledgePipelineStage = 'slice';
  const status: KnowledgePipelineStatus = 'draft';
  const docStatus: KnowledgeStatus = 'draft';
  return `---
id: ${input.id}
title: ${yamlScalar(input.title)}
type: whitepaper_slice
module: ${input.module}
intent: product_rule
source_type: whitepaper
confidence: medium
status: ${docStatus}
visibility: internal
product_versions: []
related_terms:
${yamlArray(relatedTerms)}
related_repos: []
last_verified_at: ${today}
owner: knowledge-admin
source_document_id: ${input.sourceDocumentId}
${input.sourceDocumentPath ? `source_document: ${input.sourceDocumentPath}\n` : ''}source_block_ids:
${yamlArray(input.sourceBlockIds)}
section_path:
${yamlArray(input.sectionPath)}
chunking_strategy: parent-child-v2
pipeline_stage: ${stage}
pipeline_status: ${status}
quality_status: unchecked
first_source_block_id: ${input.firstBlockId ?? ''}
last_source_block_id: ${input.lastBlockId ?? ''}
---

# ${input.title}

## 核心内容

${input.body}

## 原文来源

- source_document_id: ${input.sourceDocumentId}
- section_path: ${input.sectionPath.join(' > ')}
- source_block_ids: ${input.sourceBlockIds.join(', ')}
`;
}

function inferModule(sourceTitle: string, body: string): string {
  const text = `${sourceTitle}\n${body.slice(0, 4000)}`;
  if (/AI伴学|伴学助手|学习计划|督学提醒|题目答疑/.test(text)) {
    return 'ai-companion';
  }
  if (/EduSoho|教培|课程|班级|学员|教师|网校/.test(text)) {
    return 'edusoho-training';
  }
  return 'general';
}

function safeSlug(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function yamlScalar(value: string): string {
  return /[:#\[\]{},"']|\s$|^\s/.test(value) ? JSON.stringify(value) : value;
}

function yamlArray(values: string[]): string {
  if (values.length === 0) {
    return '  []';
  }
  return values.map((value) => `  - ${yamlScalar(value)}`).join('\n');
}

export function readDraftSlices(workspaceRoot: string, sourceDocumentId: string): Array<{ path: string; content: string }> {
  const root = sourceDraftRoot(workspaceRoot, sourceDocumentId);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(root, name))
    .flatMap((path) => {
      if (!statSync(path).isFile()) {
        return [];
      }
      return [{ path, content: readFileSync(path, 'utf8') }];
    });
}
