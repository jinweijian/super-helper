import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexesDir } from '../paths.js';

export interface KnowledgeBm25IndexEntry {
  chunk_id: string;
  terms: Record<string, number>;
  length: number;
}

export interface KnowledgeBm25Index {
  version: 1;
  averageDocumentLength: number;
  documentCount: number;
  documentFrequency: Record<string, number>;
  entries: KnowledgeBm25IndexEntry[];
}

export function bm25IndexPath(workspaceRoot: string): string {
  return join(indexesDir(workspaceRoot), 'bm25-index.json');
}

export function readKnowledgeBm25Index(workspaceRoot: string): KnowledgeBm25Index | undefined {
  const path = bm25IndexPath(workspaceRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeBm25Index;
  } catch {
    return undefined;
  }
}

export function writeKnowledgeBm25Index(input: {
  workspaceRoot: string;
  index: KnowledgeBm25Index;
}): string {
  const path = bm25IndexPath(input.workspaceRoot);
  writeFileSync(path, `${JSON.stringify(input.index, null, 2)}\n`, 'utf8');
  return path;
}
