import { join, resolve } from 'node:path';
import type { SuperHelperConfig } from '../config.js';
import { workspaceStorageKey } from '../sessions/storage-scope.js';

type WorkspaceKnowledgeInput = SuperHelperConfig['workspaces'][number];

export function resolveKnowledgeWorkspaceRoot(
  config: Pick<SuperHelperConfig, 'storage' | 'workspaces'> & Partial<Pick<SuperHelperConfig, 'knowledge'>>,
  workspaceId = config.workspaces[0]?.id,
): string {
  const baseRoot = resolve(config.knowledge?.rootDir ?? join(config.storage.rootDir, 'knowledge'));
  if (config.knowledge?.isolateByWorkspace === false) {
    return baseRoot;
  }

  const workspace = config.workspaces.find((item) => item.id === workspaceId) ?? config.workspaces[0];
  if (!workspace?.rootPath) {
    return baseRoot;
  }

  return join(baseRoot, 'workspaces', workspaceKnowledgeKey(workspace));
}

export function workspaceKnowledgeKey(workspace: WorkspaceKnowledgeInput): string {
  return workspaceStorageKey(workspace);
}
