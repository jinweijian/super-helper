import { join, relative, resolve, sep } from 'node:path';

export function knowledgeRoot(workspaceRoot: string): string {
  return join(workspaceRoot, 'knowledge');
}

export function relativeKnowledgePath(workspaceRoot: string, path: string): string {
  return relative(workspaceRoot, path).replaceAll('\\', '/');
}

export function indexesDir(workspaceRoot: string): string {
  return join(knowledgeRoot(workspaceRoot), 'indexes');
}

export function manifestPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'manifest.json');
}

export function keywordIndexPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'keyword-index.json');
}

export function chunksPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'chunks.jsonl');
}

export function ingestReportPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'ingest-report.json');
}

export function dirtyFlagPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'dirty.flag');
}

// Pipeline root paths
export function pipelineRoot(workspaceRoot: string): string {
  return join(knowledgeRoot(workspaceRoot), '_pipeline');
}

export function pipelineExtractsRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'extracts');
}

export function pipelineNormalizedRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'normalized');
}

export function pipelineDraftsRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'drafts');
}

export function pipelineRepairPlansRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'repair-plans');
}

export function pipelineReviewRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'review');
}

export function pipelinePublishRoot(workspaceRoot: string): string {
  return join(pipelineRoot(workspaceRoot), 'publish');
}

export function knowledgeReportsRoot(workspaceRoot: string): string {
  return join(knowledgeRoot(workspaceRoot), 'reports');
}

// Source-specific file paths
export function sourceBlocksPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineExtractsRoot(workspaceRoot), `${sourceDocumentId}.blocks.jsonl`);
}

export function sourceExtractReportPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineExtractsRoot(workspaceRoot), `${sourceDocumentId}.extract-report.json`);
}

export function normalizedBlocksPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineNormalizedRoot(workspaceRoot), `${sourceDocumentId}.blocks.jsonl`);
}

export function sourceNormalizeReportPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineNormalizedRoot(workspaceRoot), `${sourceDocumentId}.normalize-report.json`);
}

export function sourceDraftRoot(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineDraftsRoot(workspaceRoot), sourceDocumentId);
}

export function sourceDraftReportPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineDraftsRoot(workspaceRoot), `${sourceDocumentId}.draft-report.json`);
}

// Report file paths
export function qualityReportPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'chunk-quality-report.json');
}

export function sourceQualityReportPath(workspaceRoot: string): string {
  return join(knowledgeReportsRoot(workspaceRoot), 'source-quality-report.json');
}

export function publishReportPath(workspaceRoot: string): string {
  return join(pipelinePublishRoot(workspaceRoot), 'publish-report.json');
}

export function knowledgeEvalReportPath(workspaceRoot: string): string {
  return join(knowledgeReportsRoot(workspaceRoot), 'eval-report.json');
}

export function repairPlanPath(workspaceRoot: string, timestamp: string): string {
  return join(pipelineRepairPlansRoot(workspaceRoot), `repair-plan-${timestamp}.json`);
}

export function repairResultPath(workspaceRoot: string, timestamp: string): string {
  return join(pipelineRepairPlansRoot(workspaceRoot), `repair-result-${timestamp}.json`);
}

export function sourceReviewRecordPath(workspaceRoot: string, sourceDocumentId: string): string {
  return join(pipelineReviewRoot(workspaceRoot), `${sourceDocumentId}.review.json`);
}

export function sourcesRoot(workspaceRoot: string): string {
  return join(knowledgeRoot(workspaceRoot), '_sources');
}

// Path safety: ensure path is under knowledge root
export function isPathUnderKnowledge(workspaceRoot: string, target: string): boolean {
  const knowledge = resolve(knowledgeRoot(workspaceRoot));
  const resolved = resolve(target);
  const relativePath = relative(knowledge, resolved);
  if (relativePath.startsWith('..') || relativePath === '..' + sep) {
    return false;
  }
  return true;
}
