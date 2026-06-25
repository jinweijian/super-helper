import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestSourceDocuments } from './ingest.js';
import { updateKnowledgeIndex } from './indexes/build.js';
import { chunksPath, dirtyFlagPath, ingestReportPath, keywordIndexPath, knowledgeRoot, manifestPath } from './paths.js';
import {
  auditKnowledgeQuality,
  evaluateQualityGate,
  type KnowledgeQualityGate,
  writeKnowledgeQualityReport,
  writeSourceQualityReport,
} from './quality.js';
import {
  documentTemplates,
  evidenceChunkSchemaExample,
  KNOWLEDGE_DIRECTORIES,
  sourceMetadataExample,
  taxonomyTemplates,
} from './templates.js';
import type { KnowledgeInitResult } from './types.js';

export function initKnowledgeWorkspace(input: {
  workspaceRoot: string;
  force?: boolean;
  sourceDir?: string;
  legacyActivePublish?: boolean;
  qualityGate?: KnowledgeQualityGate;
}): KnowledgeInitResult {
  const root = knowledgeRoot(input.workspaceRoot);
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];
  const existed = existsSync(root);
  const qualityGate = input.qualityGate ?? 'warn';

  for (const directory of KNOWLEDGE_DIRECTORIES) {
    const path = join(root, directory);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
      createdDirectories.push(path);
    } else {
      mkdirSync(path, { recursive: true });
    }
  }

  for (const [file, content] of Object.entries(taxonomyTemplates)) {
    writeIfMissing(join(root, '_taxonomy', file), content, input.force, createdFiles);
  }

  for (const [file, content] of Object.entries(documentTemplates)) {
    writeIfMissing(join(root, file), content, input.force, createdFiles);
  }

  writeIfMissing(join(root, '_sources', 'whitepapers', 'example.meta.json'), sourceMetadataExample, input.force, createdFiles);
  writeIfMissing(join(root, 'indexes', 'chunk-schema.example.jsonl'), evidenceChunkSchemaExample, input.force, createdFiles);
  writeIfMissing(manifestPath(input.workspaceRoot), initialManifest(), input.force, createdFiles);
  writeIfMissing(keywordIndexPath(input.workspaceRoot), '{}\n', input.force, createdFiles);
  writeIfMissing(chunksPath(input.workspaceRoot), '', input.force, createdFiles);
  writeIfMissing(dirtyFlagPath(input.workspaceRoot), 'Knowledge index needs initial update.\n', input.force, createdFiles);
  const ingestReport = ingestSourceDocuments({
    workspaceRoot: input.workspaceRoot,
    sourceDir: input.sourceDir,
    force: input.force,
    legacyActivePublish: input.legacyActivePublish,
  });
  let qualityReport: ReturnType<typeof auditKnowledgeQuality> | undefined;
  let qualityReportFile: string | undefined;
  let sourceQualityReportFile: string | undefined;
  let qualityGateResult: ReturnType<typeof evaluateQualityGate> | undefined;
  if (ingestReport.sourceDocuments > 0 || ingestReport.skipped.length > 0) {
    const update = updateKnowledgeIndex({ workspaceRoot: input.workspaceRoot });
    ingestReport.chunks = update.chunkCount;
    writeFileSync(ingestReportPath(input.workspaceRoot), `${JSON.stringify(ingestReport, null, 2)}\n`, 'utf8');
    createdFiles.push(ingestReportPath(input.workspaceRoot));
  }
  if (qualityGate !== 'off') {
    qualityReport = auditKnowledgeQuality({ workspaceRoot: input.workspaceRoot, gate: qualityGate });
    qualityReportFile = writeKnowledgeQualityReport({ workspaceRoot: input.workspaceRoot, report: qualityReport });
    sourceQualityReportFile = writeSourceQualityReport({ workspaceRoot: input.workspaceRoot, report: qualityReport });
    qualityGateResult = evaluateQualityGate(qualityReport, qualityGate);
    createdFiles.push(qualityReportFile, sourceQualityReportFile);
  } else {
    qualityGateResult = evaluateQualityGate({
      version: 1,
      workspaceRoot: input.workspaceRoot,
      knowledgeRoot: root,
      generatedAt: new Date().toISOString(),
      thresholds: {
        minBodyChars: 80,
        maxParentChars: 2800,
        maxUnknownBlockRatio: 0.3,
        minRelatedTerms: 3,
        maxDuplicateNormalizedHashes: 1,
        multiTopicHeadingThreshold: 3,
      },
      inspected: { sourceDocuments: 0, draftSlices: 0, publishedSlices: 0, chunks: 0 },
      stageSummaries: {},
      severityCounts: { info: 0, warn: 0, error: 0 },
      issueCounts: {},
      issues: [],
      recommendedActions: [],
      gate: 'off',
    }, 'off');
  }

  return {
    knowledgeRoot: root,
    created: !existed,
    directories: createdDirectories,
    files: createdFiles,
    ingestReportPath: ingestReport.sourceDocuments > 0 || ingestReport.skipped.length > 0
      ? ingestReportPath(input.workspaceRoot)
      : undefined,
    qualityReportPath: qualityReportFile,
    sourceQualityReportPath: sourceQualityReportFile,
    qualityGateResult,
    qualitySeverityCounts: qualityReport?.severityCounts,
    qualityIssueCounts: qualityReport?.issueCounts,
  };
}

function writeIfMissing(path: string, content: string, force: boolean | undefined, createdFiles: string[]): void {
  if (!force && existsSync(path)) {
    return;
  }
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
  createdFiles.push(path);
}

function initialManifest(): string {
  return `${JSON.stringify({
    version: 1,
    updated_at: null,
    document_count: 0,
    chunk_count: 0,
    source_document_count: 0,
    documents: [],
  }, null, 2)}\n`;
}
