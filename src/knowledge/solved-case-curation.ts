import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirtyFlagPath } from './paths.js';

export interface WriteSolvedCaseDraftInput {
  workspaceRoot: string;
  documentId: string;
  moduleId: string;
  markdown: string;
}

export interface WriteSolvedCaseDraftResult {
  path: string;
}

export function writeSolvedCaseDraft(input: WriteSolvedCaseDraftInput): WriteSolvedCaseDraftResult {
  const targetDir = join(input.workspaceRoot, 'knowledge', 'tickets', 'solved-cases', input.moduleId);
  const targetPath = join(targetDir, `${input.documentId}.md`);

  mkdirSync(targetDir, { recursive: true });
  mkdirSync(join(input.workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
  writeFileSync(targetPath, input.markdown, 'utf8');
  writeFileSync(dirtyFlagPath(input.workspaceRoot), `Solved case ${input.documentId} needs indexing.\n`, 'utf8');

  return { path: targetPath };
}
