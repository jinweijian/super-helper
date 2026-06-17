import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http-utils.js';

export interface FsEntry {
  name: string;
  type: 'dir' | 'file';
  size?: number;
}

export interface FsListing {
  current: string;
  parent: string | null;
  root: string;
  entries: FsEntry[];
}

interface FsErrorPayload {
  error: string;
  code: 'not_found' | 'not_a_directory' | 'outside_allowed_root' | 'invalid_path';
}

/**
 * Resolve a user-supplied path against the home directory and reject anything
 * outside the home tree. Returning the resolved path keeps the caller honest:
 * the listing it sees reflects exactly what was allowed.
 */
export function resolveWithinHome(input: string | null | undefined): { ok: true; absolute: string; root: string } | { ok: false; error: FsErrorPayload } {
  const home = homedir();
  const root = resolve(home);
  if (!input || input.trim() === '' || input.trim() === '~') {
    return { ok: true, absolute: root, root };
  }
  const trimmed = input.trim();
  // Expand leading "~/" to HOME
  const expanded = trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')
    ? root + sep + trimmed.slice(2)
    : trimmed;
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(root, expanded);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: { error: `路径必须在 ${root} 之下`, code: 'outside_allowed_root' } };
  }
  return { ok: true, absolute, root };
}

export function listDirectory(absolute: string, root: string): FsListing | { error: FsErrorPayload } {
  if (!existsSync(absolute)) {
    return { error: { error: `路径不存在: ${absolute}`, code: 'not_found' } };
  }
  let stat;
  try {
    stat = statSync(absolute);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: { error: message, code: 'not_found' } };
  }
  if (!stat.isDirectory()) {
    return { error: { error: `不是目录: ${absolute}`, code: 'not_a_directory' } };
  }

  let dirents;
  try {
    dirents = readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: { error: message, code: 'not_found' } };
  }

  const entries: FsEntry[] = [];
  for (const dirent of dirents) {
    if (dirent.name === '.' || dirent.name === '..') continue;
    if (dirent.isDirectory()) {
      entries.push({ name: dirent.name, type: 'dir' });
    } else if (dirent.isFile()) {
      let size: number | undefined;
      try {
        size = dirent.parentPath ? statSync(resolve(dirent.parentPath, dirent.name)).size : undefined;
      } catch {
        size = undefined;
      }
      entries.push({ name: dirent.name, type: 'file', size });
    }
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans');
  });

  const parentAbs = dirname(absolute);
  const parentRel = relative(root, parentAbs);
  const parent = parentRel.startsWith('..') || isAbsolute(parentRel) || parentAbs === root ? null : parentAbs;

  return { current: absolute, parent, root, entries };
}

export async function handleFsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method !== 'GET') return false;
  if (url.pathname !== '/api/fs/dirs' && url.pathname !== '/api/fs/home') return false;

  if (url.pathname === '/api/fs/home') {
    sendJson(res, 200, { root: resolve(homedir()) });
    return true;
  }

  const requested = url.searchParams.get('path');
  const resolved = resolveWithinHome(requested);
  if (!resolved.ok) {
    sendJson(res, 400, resolved.error);
    return true;
  }
  const listing = listDirectory(resolved.absolute, resolved.root);
  if ('error' in listing) {
    const status = listing.error.code === 'not_found' ? 404 : 400;
    sendJson(res, status, listing.error);
    return true;
  }
  sendJson(res, 200, listing);
  return true;
}
