import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunksPath, dirtyFlagPath, keywordIndexPath, knowledgeRoot, manifestPath } from './paths.js';
import {
  documentTemplates,
  evidenceChunkSchemaExample,
  KNOWLEDGE_DIRECTORIES,
  sourceMetadataExample,
  taxonomyTemplates,
} from './templates.js';
import type { KnowledgeInitResult } from './types.js';

export function initKnowledgeWorkspace(input: { workspaceRoot: string; force?: boolean }): KnowledgeInitResult {
  const root = knowledgeRoot(input.workspaceRoot);
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];
  const existed = existsSync(root);

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

  return {
    knowledgeRoot: root,
    created: !existed,
    directories: createdDirectories,
    files: createdFiles,
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
