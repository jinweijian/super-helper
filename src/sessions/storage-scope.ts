import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import type { SupperHelperConfig } from '../config.js';

type WorkspaceStorageInput = SupperHelperConfig['workspaces'][number];

export function resolveSessionStorageRoot(config: SupperHelperConfig, workspaceId = config.workspaces[0]?.id): string {
  const baseRoot = resolve(config.storage.rootDir);
  if (config.storage.isolateByWorkspace === false) {
    return baseRoot;
  }

  const workspace = config.workspaces.find((item) => item.id === workspaceId) ?? config.workspaces[0];
  if (!workspace?.rootPath) {
    return baseRoot;
  }

  return join(baseRoot, 'workspaces', workspaceStorageKey(workspace));
}

export function workspaceStorageKey(workspace: WorkspaceStorageInput): string {
  const rootPath = resolve(workspace.rootPath);
  const slug = slugify(workspace.name || basename(rootPath) || workspace.id || 'workspace');
  const hash = createHash('sha256')
    .update(`${workspace.id}\0${rootPath}`)
    .digest('hex')
    .slice(0, 12);

  return `${slug}-${hash}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || 'workspace';
}
