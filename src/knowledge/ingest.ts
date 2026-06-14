import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { extractSourceBlocks, hashSourceDocument, normalizeSourceBlocks } from './extract.js';
import { buildDraftSlices } from './slicer.js';
import { relativeKnowledgePath, sourcesRoot } from './paths.js';
import type { KnowledgeIngestReport, KnowledgeSourceDocument } from './types.js';

export function defaultSourceDirectory(): string | undefined {
  const path = join(homedir(), 'Documents', 'knowledge');
  return existsSync(path) ? path : undefined;
}

export function ingestSourceDocuments(input: {
  workspaceRoot: string;
  sourceDir?: string;
  force?: boolean;
  legacyActivePublish?: boolean;
}): KnowledgeIngestReport {
  const sourceDir = input.sourceDir;
  const report: KnowledgeIngestReport = {
    version: 1,
    sourceDir,
    parserStrategy: 'pipeline-v1',
    compatibility_mode: input.legacyActivePublish ? 'legacy_active_publish' : undefined,
    quality_gate_bypassed: input.legacyActivePublish ? true : undefined,
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
    .filter((path) => statSync(path).isFile());

  for (const sourcePath of files) {
    try {
      if (!/\.(docx|md|markdown)$/i.test(sourcePath)) {
        report.skipped.push({
          path: sourcePath,
          reason: `unsupported source extension: ${extname(sourcePath).toLowerCase() || 'none'}`,
        });
        continue;
      }
      const imported = ingestOneSource(input.workspaceRoot, sourcePath, input.force, Boolean(input.legacyActivePublish));
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

function ingestOneSource(
  workspaceRoot: string,
  sourcePath: string,
  force?: boolean,
  legacyActivePublish = false,
): KnowledgeIngestReport['imported'][number] {
  const ext = extname(sourcePath).toLowerCase();
  const hash = hashSourceDocument(sourcePath);
  const sourceDocumentId = `src_${hash.slice(0, 12)}`;
  const originalName = basename(sourcePath);

  // Stage 1: Source intake
  const intake = intakeSourceDocument({
    workspaceRoot,
    sourcePath,
    sourceDocumentId,
    ext,
    force: Boolean(force),
  });
  if (intake.reused && intake.reusedImport) {
    // Already processed this source; reuse the existing slices.
    return intake.reusedImport;
  }

  // Stage 2: Block extraction
  const { blocks: extractedBlocks } = extractSourceBlocks({
    workspaceRoot,
    sourceDocumentId,
    sourcePath,
  });

  // Stage 3: Normalize blocks
  const { blocks: normalizedBlocks } = normalizeSourceBlocks({
    workspaceRoot,
    sourceDocumentId,
    blocks: extractedBlocks,
  });

  // Stage 4: Build draft slices (not yet published)
  const draftReport = buildDraftSlices({
    workspaceRoot,
    sourceDocumentId,
    sourceTitle: intake.sourceTitle,
    sourceKind: intake.sourceKind,
    sourceDocumentPath: intake.sourceDocumentRelativePath,
    normalizedBlocks,
  });

  if (legacyActivePublish) {
    legacyWriteActiveSlicesToFormalTree({
      workspaceRoot,
      sourceDocumentId,
      sourceTitle: intake.sourceTitle,
      sourceKind: intake.sourceKind,
      draftPaths: draftReport.draftPaths,
    });
  }

  return {
    sourcePath,
    sourceDocumentId,
    sourceDocumentPath: intake.sourceDocumentRelativePath,
    parentSliceIds: draftReport.draftIds,
    sourceMetaPath: intake.sourceMetaPath,
    blocksPath: join(workspaceRoot, 'knowledge', '_pipeline', 'extracts', `${sourceDocumentId}.blocks.jsonl`),
    normalizedBlocksPath: join(workspaceRoot, 'knowledge', '_pipeline', 'normalized', `${sourceDocumentId}.blocks.jsonl`),
    draftRoot: join(workspaceRoot, 'knowledge', '_pipeline', 'drafts', sourceDocumentId),
    publishReportPath: undefined,
  };
}

interface IntakeResult {
  sourceTitle: string;
  sourceKind: string;
  sourceMetaPath: string;
  sourceDocumentRelativePath: string;
  reused: boolean;
  reusedImport?: KnowledgeIngestReport['imported'][number];
}

function intakeSourceDocument(input: {
  workspaceRoot: string;
  sourcePath: string;
  sourceDocumentId: string;
  ext: string;
  force: boolean;
}): IntakeResult {
  const originalName = basename(input.sourcePath);
  const hash = hashSourceDocument(input.sourcePath);
  const sourceRoot = join(sourcesRoot(input.workspaceRoot), 'whitepapers');
  mkdirSync(sourceRoot, { recursive: true });
  const targetSource = join(sourceRoot, input.sourceDocumentId, originalName);
  const targetMeta = `${targetSource}.meta.json`;

  if (existsSync(targetMeta) && !input.force) {
    try {
      const existing = JSON.parse(readFileSync(targetMeta, 'utf8')) as KnowledgeSourceDocument;
      if (existing.sha256 === hash) {
        // Reuse existing intake
        return {
          sourceTitle: existing.title,
          sourceKind: existing.source_kind ?? (input.ext === '.docx' ? 'whitepaper_docx' : 'whitepaper_markdown'),
          sourceMetaPath: targetMeta,
          sourceDocumentRelativePath: existing.path,
          reused: true,
          reusedImport: {
            sourcePath: input.sourcePath,
            sourceDocumentId: input.sourceDocumentId,
            sourceDocumentPath: existing.path,
            parentSliceIds: [],
            sourceMetaPath: targetMeta,
            blocksPath: join(workspaceRootPath(input.workspaceRoot), 'knowledge', '_pipeline', 'extracts', `${input.sourceDocumentId}.blocks.jsonl`),
            normalizedBlocksPath: join(workspaceRootPath(input.workspaceRoot), 'knowledge', '_pipeline', 'normalized', `${input.sourceDocumentId}.blocks.jsonl`),
            draftRoot: join(workspaceRootPath(input.workspaceRoot), 'knowledge', '_pipeline', 'drafts', input.sourceDocumentId),
            publishReportPath: undefined,
          },
        };
      }
    } catch {
      // Fall through to re-intake
    }
  }

  mkdirSync(dirname(targetSource), { recursive: true });
  copyFileSync(input.sourcePath, targetSource);

  const sourceTitle = inferTitleFromFile(input.sourcePath, originalName);
  const sourceKind = input.ext === '.docx' ? 'whitepaper_docx' : 'whitepaper_markdown';
  const sourceDocumentRelativePath = relativeKnowledgePath(input.workspaceRoot, targetSource);

  const meta: KnowledgeSourceDocument = {
    id: input.sourceDocumentId,
    source_type: sourceKind,
    path: sourceDocumentRelativePath,
    sha256: hash,
    title: sourceTitle,
    downloaded_at: new Date().toISOString(),
    product_versions: [],
    owner: 'knowledge-admin',
    ingest_tool_version: 'pipeline-v1',
    original_path: input.sourcePath,
    stored_path: sourceDocumentRelativePath,
    parser: input.ext === '.docx' ? 'local-docx-v1' : 'local-markdown-v1',
    imported_at: new Date().toISOString(),
    source_kind: sourceKind,
    pipeline_status: 'imported',
  };

  writeFileSync(targetMeta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  return {
    sourceTitle,
    sourceKind,
    sourceMetaPath: targetMeta,
    sourceDocumentRelativePath,
    reused: false,
  };
}

function inferTitleFromFile(filePath: string, fallback: string): string {
  if (filePath.toLowerCase().endsWith('.docx')) {
    return fallback.replace(/\.[^.]+$/, '');
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const firstHeading = content.match(/^#{1,6}\s+(.+)$/m)?.[1];
    return firstHeading ?? fallback.replace(/\.[^.]+$/, '');
  } catch {
    return fallback.replace(/\.[^.]+$/, '');
  }
}

function workspaceRootPath(_workspaceRoot: string): string {
  return _workspaceRoot;
}

function legacyWriteActiveSlicesToFormalTree(input: {
  workspaceRoot: string;
  sourceDocumentId: string;
  sourceTitle: string;
  sourceKind: string;
  draftPaths: string[];
}): void {
  if (input.draftPaths.length === 0) {
    return;
  }
  // Read all draft slices and write them as active slices in the formal whitepapers tree
  const moduleInferred = inferModuleFromTitle(input.sourceTitle, input.sourceKind);
  const sourceSlug = safeSlug(input.sourceTitle || input.sourceDocumentId);
  const sliceDir = join(input.workspaceRoot, 'knowledge', 'whitepapers', moduleInferred, sourceSlug);
  mkdirSync(sliceDir, { recursive: true });

  // Read the source document metadata to recover the relative path
  const metaDir = join(input.workspaceRoot, 'knowledge', '_sources', 'whitepapers');
  let sourceDocumentRelative = '';
  try {
    if (existsSync(metaDir)) {
      const files = readdirSync(metaDir).filter((n) => n.endsWith('.meta.json'));
      for (const f of files) {
        try {
          const meta = JSON.parse(readFileSync(join(metaDir, f), 'utf8')) as { id?: string; path?: string };
          if (meta.id === input.sourceDocumentId && meta.path) {
            sourceDocumentRelative = meta.path;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  for (const draftPath of input.draftPaths) {
    const content = readFileSync(draftPath, 'utf8');
    // Rewrite status to active and pipeline_status to published; inject source_document
    let updated = content
      .replace(/^status:\s*draft/m, 'status: active')
      .replace(/^pipeline_status:\s*draft/m, 'pipeline_status: published')
      .replace(/^quality_status:\s*unchecked/m, 'quality_status: ok');
    if (sourceDocumentRelative && !/^source_document:/m.test(updated)) {
      updated = updated.replace(/^source_document_id:/m, `source_document: ${sourceDocumentRelative}\nsource_document_id:`);
    }
    const fileName = basename(draftPath);
    const target = join(sliceDir, fileName);
    if (!existsSync(target)) {
      writeFileSync(target, updated, 'utf8');
    }
  }
}

function inferModuleFromTitle(title: string, _kind: string): string {
  const text = title;
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
  return ascii || 'doc';
}
