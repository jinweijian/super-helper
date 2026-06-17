import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chunksPath } from '../paths.js';
import type { KnowledgeChunk } from '../types.js';

export interface ReadKnowledgeChunksResult {
  chunks: KnowledgeChunk[];
  failures: Array<{ line: number; error: string }>;
  path: string;
}

export function readKnowledgeChunks(workspaceRoot: string): ReadKnowledgeChunksResult {
  const path = chunksPath(workspaceRoot);
  if (!existsSync(path)) {
    return { chunks: [], failures: [], path };
  }
  const chunks: KnowledgeChunk[] = [];
  const failures: ReadKnowledgeChunksResult['failures'] = [];
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        chunks.push(JSON.parse(trimmed) as KnowledgeChunk);
      } catch (error) {
        failures.push({ line: index + 1, error: error instanceof Error ? error.message : String(error) });
      }
    });
  return { chunks, failures, path };
}

export function writeKnowledgeChunks(input: {
  workspaceRoot: string;
  chunks: KnowledgeChunk[];
}): string {
  const path = chunksPath(input.workspaceRoot);
  writeFileSync(path, input.chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + (input.chunks.length ? '\n' : ''), 'utf8');
  return path;
}
