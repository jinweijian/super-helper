import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export function ensureExperienceStore(rootInput: string, scope: string, sourceInstance: string, create: boolean): string {
  const root = resolve(rootInput);
  let ancestor = root;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, root));
  const workspace = realpathSync(process.cwd());
  if (!isAbsolute(rootInput) || [parse(root).root, homedir(), workspace].includes(canonical)
      || canonical.startsWith(workspace + sep)) throw new Error('EXPERIENCE_STORE_PATH');
  if (!existsSync(root)) {
    if (!create) throw new Error('EXPERIENCE_STORE_MISSING');
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  requireDirectory(root);
  const marker = join(root, 'store.json');
  if (!existsSync(marker)) {
    if (!create || readdirSync(root).length) throw new Error('EXPERIENCE_STORE_FOREIGN');
    writeExclusive(marker, JSON.stringify({ version: 1, scope, sourceInstance }));
  }
  const binding = readStoreJson(marker) as Record<string, unknown>;
  if (binding.version !== 1 || binding.scope !== scope || binding.sourceInstance !== sourceInstance) throw new Error('EXPERIENCE_STORE_SCOPE');
  for (const dir of ['private', 'private/sources', 'private/records']) {
    const target = join(root, dir);
    if (!existsSync(target)) {
      if (!create) throw new Error('EXPERIENCE_STORE_CORRUPT');
      mkdirSync(target, { mode: 0o700 });
    }
    requireDirectory(target);
  }
  return root;
}

export function requireDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('EXPERIENCE_STORE_PATH');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('EXPERIENCE_STORE_PERMISSIONS');
}

export function readStoreJson(path: string): unknown {
  try { return JSON.parse(readStoreBytes(path).toString('utf8')); }
  catch { throw new Error('EXPERIENCE_STORE_CORRUPT'); }
}

export function readStoreBytes(path: string): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    const limit = 40 * 1024 * 1024;
    if (!stat.isFile() || stat.size > limit || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw new Error();
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null);
      if (!read) break;
      count += read;
    }
    if (count !== stat.size) throw new Error();
    return buffer.subarray(0, count);
  } catch {
    throw new Error('EXPERIENCE_STORE_CORRUPT');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function writeExclusive(path: string, content: string | Uint8Array): void {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}

export function atomicStoreJson(path: string, value: unknown): void {
  atomicStoreBytes(path, JSON.stringify(value));
}

export function atomicStoreBytes(path: string, content: string | Uint8Array): void {
  const temporary = join(dirname(path), `.write-${randomUUID()}.tmp`);
  try {
    writeExclusive(temporary, content);
    if (existsSync(path) && !lstatSync(path).isFile()) throw new Error('EXPERIENCE_STORE_PATH');
    renameSync(temporary, path);
    const fd = openSync(dirname(path), constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
