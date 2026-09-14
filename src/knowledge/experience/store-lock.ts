import { existsSync, mkdirSync, renameSync, rmdirSync, unlinkSync, openSync, closeSync, fsyncSync, constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readStoreJson, requireDirectory, writeExclusive } from './store-files.js';

const ownerSchema = z.strictObject({ version: z.literal(1), pid: z.number().int().positive(),
  host: z.string().min(1), token: z.string().uuid(), createdAt: z.string().datetime() });
function owner(path: string) {
  try {
    requireDirectory(path);
    return ownerSchema.parse(readStoreJson(join(path, 'owner.json')));
  } catch { throw new Error('EXPERIENCE_LOCK_OWNER_UNKNOWN'); }
}
function syncParent(path: string) {
  const fd = openSync(dirname(path), constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function acquireExperienceLock(path: string): () => void {
  requireDirectory(dirname(path));
  if (existsSync(`${path}.recovery`)) throw new Error('EXPERIENCE_STORE_BUSY');
  try { mkdirSync(path, { mode: 0o700 }); } catch { throw new Error('EXPERIENCE_STORE_BUSY'); }
  const token = randomUUID();
  // 初始化中断留下无 owner 的锁必须人工检查，不能推断无人持有。
  writeExclusive(join(path, 'owner.json'), JSON.stringify({ version: 1, pid: process.pid, host: hostname(), token, createdAt: new Date().toISOString() }));
  syncParent(join(path, 'owner.json'));
  syncParent(path);
  return () => {
    if (owner(path).token !== token) throw new Error('EXPERIENCE_LOCK_OWNER_CHANGED');
    unlinkSync(join(path, 'owner.json'));
    rmdirSync(path);
    syncParent(path);
  };
}

/** 显式恢复；保留旧目录，不删除任何数据。PID 重用时保守拒绝恢复。 */
export function recoverDeadExperienceLock(path: string): string {
  requireDirectory(dirname(path));
  const guard = `${path}.recovery`;
  try { mkdirSync(guard, { mode: 0o700 }); } catch { throw new Error('EXPERIENCE_STORE_BUSY'); }
  try {
    const previous = owner(path);
    if (previous.host !== hostname()) throw new Error('EXPERIENCE_LOCK_OWNER_UNKNOWN');
    let absent = false;
    try { process.kill(previous.pid, 0); }
    catch (error) { absent = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    if (!absent) throw new Error('EXPERIENCE_LOCK_OWNER_ALIVE');
    if (owner(path).token !== previous.token) throw new Error('EXPERIENCE_LOCK_OWNER_CHANGED');
    const retained = `${path}.recovered-${randomUUID()}`;
    renameSync(path, retained);
    syncParent(path);
    return retained;
  } finally { rmdirSync(guard); }
}
