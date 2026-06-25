import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { discoverKnowledgeDocuments, loadSourceDocuments } from './documents/discovery.js';
import {
  indexesDir,
  knowledgeReportsRoot,
  qualityReportPath,
  sourceQualityReportPath,
} from './paths.js';
import { parseMarkdownDocument } from './frontmatter.js';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  type KnowledgeDocument,
  type KnowledgeQualityIssue,
  type KnowledgeQualityReport,
  type KnowledgeQualitySeverity,
  type KnowledgeQualityThresholds,
} from './types.js';

export type KnowledgeQualityGate = 'warn' | 'strict' | 'off';

interface AuditKnowledgeInput {
  workspaceRoot: string;
  thresholds?: Partial<KnowledgeQualityThresholds>;
  gate?: KnowledgeQualityGate;
}

const EMPTY_BODY_HEADING_TOLERANCE = 1;

export function auditKnowledgeQuality(input: AuditKnowledgeInput): KnowledgeQualityReport {
  const thresholds: KnowledgeQualityThresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...(input.thresholds ?? {}) };
  const gate: KnowledgeQualityGate = input.gate ?? 'warn';
  const issues: KnowledgeQualityIssue[] = [];
  const stageSummaries: Record<string, { warnings: number; errors: number; info: number }> = {};
  const knowledgeRoot = join(input.workspaceRoot, 'knowledge');
  const documents = [...discoverKnowledgeDocuments(input.workspaceRoot), ...discoverDraftSlices(input.workspaceRoot)];
  const sourceDocs = loadSourceDocuments(input.workspaceRoot);
  const knownSourceBlockIds = loadKnownSourceBlockIds(input.workspaceRoot, sourceDocs);

  // Source-level audit
  for (const source of sourceDocs) {
    auditSourceProvenance(source, issues);
  }

  // Slice-level audit
  const duplicateHashMap = computeDuplicateHashes(documents);
  for (const doc of documents) {
    auditSliceDocument(doc, documents, duplicateHashMap, thresholds, issues, knownSourceBlockIds);
  }

  // Chunks audit
  const chunkCount = auditChunks(documents, input.workspaceRoot, issues);

  // Per-source extract reports
  auditPerSourceExtracts(input.workspaceRoot, sourceDocs, issues);

  // Aggregate
  for (const issue of issues) {
    const stage = inferStage(issue);
    const bucket = stageSummaries[stage] ?? { warnings: 0, errors: 0, info: 0 };
    if (issue.severity === 'error') {
      bucket.errors += 1;
    } else if (issue.severity === 'warn') {
      bucket.warnings += 1;
    } else {
      bucket.info += 1;
    }
    stageSummaries[stage] = bucket;
  }

  const severityCounts: Record<KnowledgeQualitySeverity, number> = { info: 0, warn: 0, error: 0 };
  const issueCounts: Record<string, number> = {};
  for (const issue of issues) {
    severityCounts[issue.severity] += 1;
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
  }

  // Sort issues deterministically
  issues.sort((a, b) => a.code.localeCompare(b.code) || (a.documentId ?? '').localeCompare(b.documentId ?? ''));

  const recommendedActions = recommendActions(issueCounts);

  return {
    version: 1,
    workspaceRoot: input.workspaceRoot,
    knowledgeRoot,
    generatedAt: new Date().toISOString(),
    thresholds,
    inspected: {
      sourceDocuments: sourceDocs.length,
      draftSlices: documents.filter((d) => d.frontmatter.status === 'draft').length,
      publishedSlices: documents.filter((d) => d.frontmatter.status === 'active').length,
      chunks: chunkCount,
    },
    stageSummaries,
    severityCounts,
    issueCounts,
    issues,
    recommendedActions,
    gate,
  };
}

function inferStage(issue: KnowledgeQualityIssue): string {
  switch (issue.code) {
    case 'parser_empty':
    case 'too_many_unknown_blocks':
    case 'toc_not_removed':
    case 'header_footer_noise':
    case 'table_lost':
    case 'list_structure_lost':
    case 'heading_structure_broken':
    case 'duplicate_paragraphs':
    case 'source_provenance_missing':
      return 'extract';
    case 'empty_body':
    case 'heading_only':
    case 'toc_like':
    case 'too_short':
    case 'too_long':
    case 'duplicate_content':
    case 'multi_topic_slice':
    case 'broken_coreference':
    case 'not_answer_bearing':
    case 'missing_source_document':
    case 'missing_source_document_id':
    case 'missing_source_block_ids':
    case 'missing_source_blocks':
    case 'missing_section_path':
    case 'missing_parent':
    case 'orphan_chunk':
    case 'low_signal_terms':
      return 'slice';
    default:
      return 'audit';
  }
}

function auditSourceProvenance(
  source: { id: string; sha256?: string; path?: string; title?: string },
  issues: KnowledgeQualityIssue[],
): void {
  if (!source.sha256 || !source.path) {
    issues.push({
      code: 'source_provenance_missing',
      severity: 'error',
      message: 'Source metadata missing sha256 or stored path.',
      documentId: source.id,
      source: source.path,
    });
  }
}

function computeDuplicateHashes(documents: KnowledgeDocument[]): Map<string, KnowledgeDocument[]> {
  const map = new Map<string, KnowledgeDocument[]>();
  for (const doc of documents) {
    const hash = hashMeaningfulBody(doc);
    if (!hash) {
      continue;
    }
    const existing = map.get(hash) ?? [];
    existing.push(doc);
    map.set(hash, existing);
  }
  return new Map(Array.from(map.entries()).filter(([, docs]) => docs.length > 1));
}

function hashMeaningfulBody(doc: KnowledgeDocument): string {
  const text = meaningfulBody(doc);
  if (!text) {
    return '';
  }
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function meaningfulBody(doc: KnowledgeDocument): string {
  return doc.body
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^##\s+(可回答的问题|原文来源)/.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function discoverDraftSlices(workspaceRoot: string): KnowledgeDocument[] {
  const draftsRoot = join(workspaceRoot, 'knowledge', '_pipeline', 'drafts');
  if (!existsSync(draftsRoot)) {
    return [];
  }
  const documents: KnowledgeDocument[] = [];
  for (const sourceDir of readdirSync(draftsRoot)) {
    const sourcePath = join(draftsRoot, sourceDir);
    if (!statSync(sourcePath).isDirectory()) {
      continue;
    }
    for (const file of readdirSync(sourcePath)) {
      if (!file.endsWith('.md')) {
        continue;
      }
      const fullPath = join(sourcePath, file);
      if (!statSync(fullPath).isFile()) {
        continue;
      }
      try {
        const parsed = parseMarkdownDocument(readFileSync(fullPath, 'utf8'), fullPath);
        const rel = relative(workspaceRoot, fullPath).replaceAll('\\', '/');
        documents.push({
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          headings: extractHeadings(parsed.body),
          path: fullPath,
          relativePath: rel,
        });
      } catch {
        // Skip malformed drafts; they are still auditable later
      }
    }
  }
  return documents;
}

function extractHeadings(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
    .filter((heading): heading is string => Boolean(heading));
}

function auditSliceDocument(
  doc: KnowledgeDocument,
  all: KnowledgeDocument[],
  duplicateHashes: Map<string, KnowledgeDocument[]>,
  thresholds: KnowledgeQualityThresholds,
  issues: KnowledgeQualityIssue[],
  knownSourceBlockIds: Map<string, Set<string>>,
): void {
  const fm = doc.frontmatter;

  if (!fm.source_document) {
    issues.push({
      code: 'missing_source_document',
      severity: 'error',
      message: `Slice ${fm.id} lacks source_document provenance.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (!fm.source_document_id) {
    issues.push({
      code: 'missing_source_document_id',
      severity: 'error',
      message: `Slice ${fm.id} lacks source_document_id provenance.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (fm.source_document_id && !fm.source_block_ids?.length) {
    issues.push({
      code: 'missing_source_block_ids',
      severity: 'warn',
      message: `Slice ${fm.id} is missing source_block_ids; cannot trace to source.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (fm.source_block_ids && fm.source_block_ids.length > 0 && fm.source_document_id) {
    const knownBlockIds = knownSourceBlockIds.get(fm.source_document_id);
    if (knownBlockIds) {
      const missingBlocks = fm.source_block_ids.filter((id) => !knownBlockIds.has(id));
      if (missingBlocks.length > 0) {
        issues.push({
          code: 'missing_source_blocks',
          severity: 'warn',
          message: `Slice ${fm.id} references ${missingBlocks.length} unknown source block id(s).`,
          documentId: fm.id,
          source: doc.relativePath,
          details: { missingBlocks },
        });
      }
    }
  }

  if (!fm.section_path || fm.section_path.length === 0) {
    issues.push({
      code: 'missing_section_path',
      severity: 'warn',
      message: `Slice ${fm.id} has no section_path.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  const body = meaningfulBody(doc);
  if (!body) {
    issues.push({
      code: 'empty_body',
      severity: 'warn',
      message: `Slice ${fm.id} has empty meaningful body.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
    return;
  }

  if (body.length < thresholds.minBodyChars) {
    issues.push({
      code: 'too_short',
      severity: 'warn',
      message: `Slice ${fm.id} body length ${body.length} below ${thresholds.minBodyChars}.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (body.length > thresholds.maxParentChars) {
    issues.push({
      code: 'too_long',
      severity: 'warn',
      message: `Slice ${fm.id} body length ${body.length} exceeds ${thresholds.maxParentChars}.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (isTocLike(doc)) {
    issues.push({
      code: 'toc_like',
      severity: 'warn',
      message: `Slice ${fm.id} resembles table-of-contents or navigation.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (isHeadingOnly(doc, body)) {
    issues.push({
      code: 'heading_only',
      severity: 'warn',
      message: `Slice ${fm.id} contains headings but no substantive body.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (isMultiTopic(doc, thresholds.multiTopicHeadingThreshold)) {
    issues.push({
      code: 'multi_topic_slice',
      severity: 'warn',
      message: `Slice ${fm.id} contains multiple unrelated headings.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (isBrokenCoreference(doc.body)) {
    issues.push({
      code: 'broken_coreference',
      severity: 'warn',
      message: `Slice ${fm.id} contains unresolved references.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  if (!hasAnswerBearingSentence(doc.body)) {
    issues.push({
      code: 'not_answer_bearing',
      severity: 'warn',
      message: `Slice ${fm.id} has no answer-bearing sentence.`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  const relatedTermsCount = fm.related_terms?.length ?? 0;
  if (relatedTermsCount < thresholds.minRelatedTerms) {
    issues.push({
      code: 'low_signal_terms',
      severity: 'info',
      message: `Slice ${fm.id} has ${relatedTermsCount} related_terms (min ${thresholds.minRelatedTerms}).`,
      documentId: fm.id,
      source: doc.relativePath,
    });
  }

  // Duplicate detection
  const hash = hashMeaningfulBody(doc);
  if (hash) {
    const group = duplicateHashes.get(hash);
    if (group && group.length > 1) {
      const isFirst = group[0] === doc;
      if (!isFirst) {
        issues.push({
          code: 'duplicate_content',
          severity: 'warn',
          message: `Slice ${fm.id} duplicates content from ${group[0]?.frontmatter.id ?? 'unknown'}.`,
          documentId: fm.id,
          source: doc.relativePath,
          contentHash: hash,
        });
      }
    }
  }

  // Reference integrity: ensure referenced parent (solved case) exists
  if (fm.type === 'solved_case' || fm.type === 'unresolved_case') {
    // No parent relationship required at this level
  }
}

function isTocLike(doc: KnowledgeDocument): boolean {
  const lines = doc.body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const shortLines = lines.filter((l) => l.length < 60);
  if (shortLines.length / lines.length < 0.7) {
    return false;
  }
  const numbered = lines.filter((l) => /^[一二三四五六七八九十0-9]+[、\.]/.test(l) || /^第[一二三四五六七八九十百千]+/i.test(l));
  if (numbered.length >= Math.min(5, lines.length / 2)) {
    return true;
  }
  if (/目录/.test(doc.body) && lines.length < 20) {
    return true;
  }
  return false;
}

function isHeadingOnly(doc: KnowledgeDocument, body: string): boolean {
  if (!body) return false;
  const headingCount = (doc.body.match(/^#{1,6}\s+/gm) ?? []).length;
  return headingCount > EMPTY_BODY_HEADING_TOLERANCE && body.length < 80;
}

function isMultiTopic(doc: KnowledgeDocument, threshold: number): boolean {
  const headings = (doc.body.match(/^#{1,4}\s+(.+)$/gm) ?? [])
    .map((h) => h.replace(/^#{1,4}\s+/, '').trim())
    .filter((heading) => !isTemplateProvenanceHeading(heading));
  if (headings.length < 2) return false;
  // Detect unrelated headings by checking for shared significant tokens
  const tokensPerHeading = headings.map((h) => new Set(h.match(/[一-龥]{2,}/g) ?? []));
  let shared = 0;
  let total = 0;
  for (let i = 0; i < tokensPerHeading.length; i += 1) {
    for (let j = i + 1; j < tokensPerHeading.length; j += 1) {
      total += 1;
      const intersection = new Set([...tokensPerHeading[i]].filter((t) => tokensPerHeading[j].has(t)));
      if (intersection.size > 0) {
        shared += 1;
      }
    }
  }
  if (total === 0) return false;
  return shared / total < 0.3 && headings.length >= threshold;
}

function isTemplateProvenanceHeading(heading: string): boolean {
  return ['核心内容', '原文来源'].includes(heading);
}

const COREFERENCE_TERMS = ['该功能', '上述', '如下图', '该配置', '该流程', '此功能', '该模块', '本节', '上面提到', '如下所示'];

function isBrokenCoreference(body: string): boolean {
  const text = body.replace(/\s+/g, '');
  const matches = COREFERENCE_TERMS.reduce((acc, term) => acc + (text.includes(term) ? 1 : 0), 0);
  return matches >= 2;
}

const ANSWER_BEARING_PATTERNS = [
  /(当|如果|若|在).{2,30}(时|情况|条件下|之后)/,
  /步骤[一二三四五六七八九十0-9]+/,
  /[一二三四五六七八九十0-9]+[\.、]/,
  /支持|不支持|会|不会|需要|必须|返回|提示|提醒|开通|关闭|开启/,
  /(会|不会).{0,20}(提醒|提示|开通|触发|记录|通知|发送)/,
  /学习日.{0,15}(提醒|未完成|任务)/,
  /(search|搜索).{0,20}(按|根据|通过|支持)/i,
];

function hasAnswerBearingSentence(body: string): boolean {
  const sentences = body.split(/[\n。；;]/).map((s) => s.trim()).filter(Boolean);
  return sentences.some((s) => ANSWER_BEARING_PATTERNS.some((p) => p.test(s)));
}

function auditChunks(documents: KnowledgeDocument[], workspaceRoot: string, issues: KnowledgeQualityIssue[]): number {
  const chunksPath = join(workspaceRoot, 'knowledge', 'indexes', 'chunks.jsonl');
  if (!existsSync(chunksPath)) {
    return 0;
  }
  const knownIds = new Set(documents.map((d) => d.frontmatter.id));
  const parentIdsWithChunks = new Set<string>();
  const lines = readFileSync(chunksPath, 'utf8').split(/\r?\n/).filter(Boolean);
  let parsedChunkCount = 0;
  for (const line of lines) {
    try {
      const chunk = JSON.parse(line) as {
        chunk_id: string;
        parent_id: string;
        artifact_version?: number;
        source_block_ids?: string[];
        section_path?: string[];
        manual_split_required?: boolean;
      };
      parsedChunkCount += 1;
      parentIdsWithChunks.add(chunk.parent_id);
      if (!knownIds.has(chunk.parent_id)) {
        issues.push({
          code: 'orphan_chunk',
          severity: 'error',
          message: `Chunk ${chunk.chunk_id} references unknown parent_id ${chunk.parent_id}.`,
          chunkId: chunk.chunk_id,
        });
      }
      if (chunk.artifact_version === 2 && !chunk.source_block_ids?.length) {
        issues.push({
          code: 'missing_source_block_ids',
          severity: 'error',
          message: `V2 chunk ${chunk.chunk_id} has no source_block_ids.`,
          documentId: chunk.parent_id,
          chunkId: chunk.chunk_id,
        });
      }
      if (chunk.artifact_version === 2 && !chunk.section_path?.length) {
        issues.push({
          code: 'missing_section_path',
          severity: 'error',
          message: `V2 chunk ${chunk.chunk_id} has no section_path.`,
          documentId: chunk.parent_id,
          chunkId: chunk.chunk_id,
        });
      }
      if (chunk.manual_split_required) {
        issues.push({
          code: 'too_long',
          severity: 'warn',
          message: `Chunk ${chunk.chunk_id} preserves an oversized indivisible block and requires manual split.`,
          documentId: chunk.parent_id,
          chunkId: chunk.chunk_id,
        });
      }
    } catch {
      // ignore malformed lines
    }
  }
  for (const document of documents) {
    if (document.frontmatter.status !== 'active') {
      continue;
    }
    if (!parentIdsWithChunks.has(document.frontmatter.id)) {
      issues.push({
        code: 'missing_parent',
        severity: 'warn',
        message: `Active parent ${document.frontmatter.id} has no derived chunk after index generation.`,
        documentId: document.frontmatter.id,
        source: document.relativePath,
      });
    }
  }
  return parsedChunkCount;
}

function loadKnownSourceBlockIds(
  workspaceRoot: string,
  sourceDocs: Array<{ id: string }>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const source of sourceDocs) {
    const blocksPath = join(workspaceRoot, 'knowledge', '_pipeline', 'extracts', `${source.id}.blocks.jsonl`);
    if (!existsSync(blocksPath)) continue;
    const ids = new Set<string>();
    for (const line of readFileSync(blocksPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const block = JSON.parse(trimmed) as { block_id?: string };
        if (block.block_id) ids.add(block.block_id);
      } catch {
        // ignore malformed
      }
    }
    map.set(source.id, ids);
  }
  return map;
}

function auditPerSourceExtracts(
  workspaceRoot: string,
  sourceDocs: Array<{ id: string; path?: string }>,
  issues: KnowledgeQualityIssue[],
): void {
  for (const source of sourceDocs) {
    if (!source.id) continue;
    const extractPath = join(workspaceRoot, 'knowledge', '_pipeline', 'extracts', `${source.id}.extract-report.json`);
    if (!existsSync(extractPath)) continue;
    let report: {
      blockCounts?: Record<string, number>;
      unknownBlockCount?: number;
      skippedTocCount?: number;
      warnings?: string[];
      errors?: string[];
      fatal?: boolean;
    };
    try {
      report = JSON.parse(readFileSync(extractPath, 'utf8'));
    } catch {
      continue;
    }
    const blockCounts = report.blockCounts ?? {};
    const totalBlocks = Object.values(blockCounts).reduce((acc, count) => acc + count, 0);
    const unknown = report.unknownBlockCount ?? 0;
    if (report.fatal || totalBlocks === 0) {
      issues.push({
        code: 'parser_empty',
        severity: 'error',
        message: `Source ${source.id} produced no parseable blocks.`,
        sourceDocument: source.id,
        source: source.path,
      });
    }
    if (totalBlocks > 0 && unknown / totalBlocks > DEFAULT_QUALITY_THRESHOLDS.maxUnknownBlockRatio) {
      issues.push({
        code: 'too_many_unknown_blocks',
        severity: 'warn',
        message: `Source ${source.id} has ${unknown}/${totalBlocks} unknown blocks (${(unknown / totalBlocks).toFixed(2)}).`,
        sourceDocument: source.id,
        details: { blockCounts, unknown, total: totalBlocks },
      });
    }
    if (report.warnings?.some((w) => /table_lost|list_structure_lost/.test(w))) {
      if (report.warnings.some((w) => /table_lost/.test(w))) {
        issues.push({
          code: 'table_lost',
          severity: 'warn',
          message: `Source ${source.id} reported table loss during extraction.`,
          sourceDocument: source.id,
        });
      }
      if (report.warnings.some((w) => /list_structure_lost/.test(w))) {
        issues.push({
          code: 'list_structure_lost',
          severity: 'warn',
          message: `Source ${source.id} reported list structure loss during extraction.`,
          sourceDocument: source.id,
        });
      }
    }
    if (report.warnings?.some((w) => /toc_not_removed/.test(w))) {
      issues.push({
        code: 'toc_not_removed',
        severity: 'warn',
        message: `Source ${source.id} reported table-of-contents noise.`,
        sourceDocument: source.id,
      });
    }

    const normalizePath = join(workspaceRoot, 'knowledge', '_pipeline', 'normalized', `${source.id}.normalize-report.json`);
    if (!existsSync(normalizePath)) {
      continue;
    }
    let normalizeReport: {
      excludedBlockCounts?: Record<string, number>;
      headingStructureWarnings?: string[];
    };
    try {
      normalizeReport = JSON.parse(readFileSync(normalizePath, 'utf8'));
    } catch {
      continue;
    }
    const excluded = normalizeReport.excludedBlockCounts ?? {};
    if ((excluded.header_footer ?? 0) > 0) {
      issues.push({
        code: 'header_footer_noise',
        severity: 'info',
        message: `Source ${source.id} had ${excluded.header_footer} header/footer block(s) removed during normalization.`,
        sourceDocument: source.id,
        details: { excluded },
      });
    }
    if ((normalizeReport.headingStructureWarnings ?? []).length > 0) {
      issues.push({
        code: 'heading_structure_broken',
        severity: 'warn',
        message: `Source ${source.id} has heading structure warning(s).`,
        sourceDocument: source.id,
        details: { warnings: normalizeReport.headingStructureWarnings },
      });
    }
  }
}

function recommendActions(issueCounts: Record<string, number>): string[] {
  const actions: string[] = [];
  if (issueCounts['empty_body'] || issueCounts['heading_only'] || issueCounts['too_short']) {
    actions.push('Re-run draft slice generation with relaxed thresholds or merge adjacent short slices.');
  }
  if (issueCounts['duplicate_content']) {
    actions.push('Review duplicate draft slices and remove non-canonical duplicates.');
  }
  if (issueCounts['missing_source_block_ids'] || issueCounts['missing_source_blocks']) {
    actions.push('Repair source block provenance for legacy slices.');
  }
  if (issueCounts['multi_topic_slice']) {
    actions.push('Split multi-topic slices on heading boundaries.');
  }
  if (issueCounts['not_answer_bearing']) {
    actions.push('Mark not_answer_bearing slices as review_required.');
  }
  if (issueCounts['low_signal_terms']) {
    actions.push('Add related_terms using titles, section paths, and high-signal module aliases.');
  }
  if (issueCounts['orphan_chunk'] || issueCounts['missing_parent']) {
    actions.push('Rebuild manifest and chunks to resolve orphan_chunk issues.');
  }
  if (issueCounts['source_provenance_missing']) {
    actions.push('Re-intake source files to restore sha256 and stored_path metadata.');
  }
  return actions;
}

export function writeKnowledgeQualityReport(input: { workspaceRoot: string; report: KnowledgeQualityReport }): string {
  mkdirSync(indexesDir(input.workspaceRoot), { recursive: true });
  const path = qualityReportPath(input.workspaceRoot);
  writeFileSync(path, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8');
  return path;
}

export function readKnowledgeQualityReport(workspaceRoot: string): KnowledgeQualityReport | undefined {
  const path = qualityReportPath(workspaceRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeQualityReport;
  } catch {
    return undefined;
  }
}

export function writeSourceQualityReport(input: { workspaceRoot: string; report: KnowledgeQualityReport }): string {
  mkdirSync(knowledgeReportsRoot(input.workspaceRoot), { recursive: true });
  const path = sourceQualityReportPath(input.workspaceRoot);
  writeFileSync(path, `${JSON.stringify(sourceQualityReportFromQualityReport(input.report), null, 2)}\n`, 'utf8');
  return path;
}

export function sourceQualityReportFromQualityReport(report: KnowledgeQualityReport): KnowledgeQualityReport {
  const sourceCodes = new Set<string>([
    'parser_empty',
    'too_many_unknown_blocks',
    'toc_not_removed',
    'header_footer_noise',
    'table_lost',
    'list_structure_lost',
    'heading_structure_broken',
    'duplicate_paragraphs',
    'source_provenance_missing',
  ]);
  const issues = report.issues.filter((issue) => sourceCodes.has(issue.code));
  const severityCounts: Record<KnowledgeQualitySeverity, number> = { info: 0, warn: 0, error: 0 };
  const issueCounts: Record<string, number> = {};
  const stageSummaries: Record<string, { warnings: number; errors: number; info: number }> = {};
  for (const issue of issues) {
    severityCounts[issue.severity] += 1;
    issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    const stage = inferStage(issue);
    const bucket = stageSummaries[stage] ?? { warnings: 0, errors: 0, info: 0 };
    if (issue.severity === 'error') bucket.errors += 1;
    else if (issue.severity === 'warn') bucket.warnings += 1;
    else bucket.info += 1;
    stageSummaries[stage] = bucket;
  }
  return {
    ...report,
    inspected: {
      sourceDocuments: report.inspected.sourceDocuments,
      draftSlices: 0,
      publishedSlices: 0,
      chunks: 0,
    },
    stageSummaries,
    severityCounts,
    issueCounts,
    issues,
    recommendedActions: recommendActions(issueCounts),
  };
}

export function readSourceQualityReport(workspaceRoot: string): KnowledgeQualityReport | undefined {
  const path = sourceQualityReportPath(workspaceRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeQualityReport;
  } catch {
    return undefined;
  }
}

export function evaluateQualityGate(report: KnowledgeQualityReport, gate: KnowledgeQualityGate): {
  passed: boolean;
  exitCode: number;
  reason?: string;
} {
  if (gate === 'off') {
    return { passed: true, exitCode: 0, reason: 'quality gate disabled' };
  }
  if (gate === 'warn') {
    if (report.severityCounts.error > 0) {
      // Warn gate still passes but reports errors visibly
      return { passed: true, exitCode: 0, reason: `${report.severityCounts.error} error issues visible` };
    }
    return { passed: true, exitCode: 0 };
  }
  // Strict
  if (report.severityCounts.error > 0) {
    return {
      passed: false,
      exitCode: 2,
      reason: `Strict gate failed: ${report.severityCounts.error} error issues must be fixed before publishing.`,
    };
  }
  return { passed: true, exitCode: 0 };
}

// Internal helper for the indexer integration: load quality report if available
export function loadChunkQualityMap(workspaceRoot: string): Map<string, { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] }> {
  const report = readKnowledgeQualityReport(workspaceRoot);
  const map = new Map<string, { severity: 'ok' | 'info' | 'warn' | 'error'; issues: string[] }>();
  if (!report) {
    return map;
  }
  for (const issue of report.issues) {
    if (!issue.documentId) continue;
    const current = map.get(issue.documentId) ?? { severity: 'ok' as const, issues: [] as string[] };
    if (issue.severity === 'error') current.severity = 'error';
    else if (issue.severity === 'warn' && current.severity !== 'error') current.severity = 'warn';
    else if (issue.severity === 'info' && current.severity === 'ok') current.severity = 'info';
    current.issues.push(issue.code);
    map.set(issue.documentId, current);
  }
  return map;
}

// Re-export KnowledgeDocument for downstream tools
export type { KnowledgeDocument };
// Re-export for callers that import from the path
export { parseMarkdownDocument };
// Also expose useful internal helpers for tests
export const __testing = { isTocLike, isHeadingOnly, isMultiTopic, isBrokenCoreference, hasAnswerBearingSentence };
