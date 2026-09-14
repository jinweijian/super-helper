import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const load = () => import('../dist/knowledge/experience/store-lock.js');
function fixture(t) { const root = mkdtempSync(join(tmpdir(), 'experience-lock-')); t.after(() => rmSync(root, { recursive: true, force: true })); return join(root, 'writer.lock'); }
test('experience lock refuses recovery of a live owner and releases its own token', async t => {
  const { acquireExperienceLock, recoverDeadExperienceLock } = await load();
  const path = fixture(t);
  const release = acquireExperienceLock(path);
  assert.throws(() => acquireExperienceLock(path), /EXPERIENCE_STORE_BUSY/);
  assert.throws(() => recoverDeadExperienceLock(path), /EXPERIENCE_LOCK_OWNER_ALIVE/);
  release();
  assert.equal(existsSync(path), false);
});
test('experience lock recovers a real exited process by retaining its lock evidence', async t => {
  const { acquireExperienceLock, recoverDeadExperienceLock } = await load();
  const path = fixture(t);
  const url = pathToFileURL(resolve('dist/knowledge/experience/store-lock.js')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { acquireExperienceLock } from ${JSON.stringify(url)}; acquireExperienceLock(process.argv[1]); process.exit(0);`, path]);
  assert.equal(child.status, 0, child.stderr.toString());
  const recovered = recoverDeadExperienceLock(path);
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(recovered), true);
  const release = acquireExperienceLock(path); release();
});
test('experience lock does not guess the owner of an incomplete lock', async t => {
  const { recoverDeadExperienceLock } = await load();
  const path = fixture(t); mkdirSync(path, { mode: 0o700 });
  assert.throws(() => recoverDeadExperienceLock(path), /EXPERIENCE_LOCK_OWNER_UNKNOWN/);
  assert.equal(existsSync(path), true);
});
