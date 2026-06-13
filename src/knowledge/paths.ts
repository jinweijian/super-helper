import { join, relative } from 'node:path';

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
