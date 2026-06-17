import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { keywordIndexPath } from '../paths.js';

export type KnowledgeKeywordIndex = Record<string, string[]>;

export function readKnowledgeKeywordIndex(workspaceRoot: string): KnowledgeKeywordIndex {
  const path = keywordIndexPath(workspaceRoot);
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as KnowledgeKeywordIndex;
  } catch {
    return {};
  }
}

export function writeKnowledgeKeywordIndex(input: {
  workspaceRoot: string;
  index: KnowledgeKeywordIndex;
}): string {
  const path = keywordIndexPath(input.workspaceRoot);
  writeFileSync(path, `${JSON.stringify(input.index, null, 2)}\n`, 'utf8');
  return path;
}
