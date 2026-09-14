import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, statSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const load = () => import('../dist/knowledge/experience/batch-repository.js');
const options = { scope: 'fixture-workspace', sourceInstance: 'fixture-redmine' };
const csv = (cause = '接口拦截', date = '2026-09-09 10:00', id = '7') => Buffer.from(`#,项目,主题,工单问题原因,更新于\n${id},P,保存失败,${cause},${date}`);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'experience-batch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'store');
}

test('experience batch import saves restricted raw snapshot and idempotent normalized sources', async (t) => {
  const { ExperienceBatchRepository } = await load();
  const root = fixture(t);
  const repo = new ExperienceBatchRepository(root, options);
  const first = await repo.importCsv(csv());
  assert.equal(first.imported, 1);
  assert.equal((await repo.importCsv(csv())).skipped, 1);
  assert.equal(repo.status(first.batchId).total, 1);
  const sources = repo.listPending();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].source.fields.cause.value, '接口拦截');
  const snapshot = join(root, 'private', 'sources', `${sources[0].source.fileHash}.csv`);
  assert.deepEqual(readFileSync(snapshot), csv());
  if (process.platform !== 'win32') assert.equal(statSync(snapshot).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(first), /接口拦截|保存失败/);
});

test('experience import refuses lost state instead of overwriting source history', async t => {
  const { ExperienceBatchRepository } = await load();
  const root = fixture(t);
  const repo = new ExperienceBatchRepository(root, options);
  await repo.importCsv(csv());
  unlinkSync(join(root, 'private', 'state.json'));
  assert.throws(() => repo.listPending(), /EXPERIENCE_STORE_CORRUPT/);
  await assert.rejects(repo.importCsv(csv('旧记录', '2026-09-01 10:00')), /EXPERIENCE_STORE_CORRUPT/);
});

test('experience batch quarantines stale and ambiguous revisions but preserves prior records on partial export', async (t) => {
  const { ExperienceBatchRepository } = await load();
  const repo = new ExperienceBatchRepository(fixture(t), options);
  await repo.importCsv(csv());
  assert.equal((await repo.importCsv(csv('新原因', '2026-09-10 10:00'))).imported, 1);
  assert.equal((await repo.importCsv(csv('旧原因', '2026-09-08 10:00'))).quarantined, 1);
  assert.equal((await repo.importCsv(csv('冲突原因', '2026-09-10 10:00'))).quarantined, 1);
  await repo.importCsv(csv('另一工单', '2026-09-10 11:00', '8'));
  assert.equal(repo.listPending().length, 2);
  assert.equal(repo.listPending().find((item) => item.source.ticketId === '7').source.fields.cause.value, '新原因');
});

test('experience batch refuses scope mismatch, corrupt state, symlinks and foreign directories', async (t) => {
  const { ExperienceBatchRepository } = await load();
  const root = fixture(t);
  const repo = new ExperienceBatchRepository(root, options);
  await repo.importCsv(csv());
  assert.throws(() => new ExperienceBatchRepository(root, { ...options, scope: 'other' }).listPending(), /EXPERIENCE_STORE_SCOPE/);
  writeFileSync(join(root, 'private', 'state.json'), '{corrupt-private-value');
  assert.throws(() => repo.listPending(), (e) => { assert.equal(e.message, 'EXPERIENCE_STORE_CORRUPT'); return true; });
  const other = fixture(t);
  mkdirSync(other, { mode: 0o700 });
  writeFileSync(join(other, 'user-file.txt'), 'preserve');
  await assert.rejects(new ExperienceBatchRepository(other, options).importCsv(csv()), /EXPERIENCE_STORE_FOREIGN/);
  const link = fixture(t);
  symlinkSync(other, link);
  await assert.rejects(new ExperienceBatchRepository(link, options).importCsv(csv()), /EXPERIENCE_STORE_PATH/);
});

test('experience batch cancellation keeps checkpoint and later resumes without duplicating accepted rows', async (t) => {
  const { ExperienceBatchRepository } = await load();
  const repo = new ExperienceBatchRepository(fixture(t), options);
  const controller = new AbortController();
  const input = Buffer.from('#,项目,主题,工单问题原因\n1,P,a,b\n2,P,c,d');
  const first = await repo.importCsv(input, { signal: controller.signal, onRecord: () => controller.abort() });
  assert.equal(first.status, 'paused');
  assert.equal(repo.listPending().length, 1);
  const second = await repo.importCsv(input);
  assert.equal(second.status, 'complete');
  assert.equal(repo.listPending().length, 2);
});

test('experience store lock fails closed and existing source hash is checked before consumption', async (t) => {
  const { ExperienceBatchRepository } = await load();
  const root = fixture(t);
  const repo = new ExperienceBatchRepository(root, options);
  await repo.importCsv(csv());
  mkdirSync(join(root, 'private', 'writer.lock'));
  await assert.rejects(repo.importCsv(csv()), /EXPERIENCE_STORE_BUSY/);
  rmSync(join(root, 'private', 'writer.lock'), { recursive: true });
  const item = repo.listPending()[0];
  writeFileSync(join(root, 'private', 'records', `${item.sourceRevision}.json`), '{}');
  assert.throws(() => repo.listPending(), /EXPERIENCE_STORE_CORRUPT/);
});

test('experience CLI import and status use the actual offline application path', async (t) => {
  const store = fixture(t);
  const file = join(store, '..', 'source.csv');
  writeFileSync(file, csv());
  const common = ['--store', store, '--scope', options.scope, '--source-instance', options.sourceInstance];
  const result = spawnSync(process.execPath, ['dist/cli.js', 'experience', 'import', '--file', file, ...common], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.imported, 1);
  const status = spawnSync(process.execPath, ['dist/cli.js', 'experience', 'status', '--batch', report.batchId, ...common], { encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).total, 1);
  assert.doesNotMatch(result.stdout + status.stdout, /接口拦截|保存失败/);
});

test('experience CLI imports a custom export with an explicit mapping file', async t => {
  const store = fixture(t);
  const file = join(store, '..', 'custom.csv');
  const mapping = join(store, '..', 'mapping.json');
  writeFileSync(file, '单号,项目,摘要,原因说明\n7,P,失败,请求拦截');
  writeFileSync(mapping, JSON.stringify({ ticketId: '单号', title: '摘要', cause: '原因说明' }));
  const result = spawnSync(process.execPath, ['dist/cli.js', 'experience', 'import', '--file', file, '--mapping', mapping,
    '--store', store, '--scope', options.scope, '--source-instance', options.sourceInstance], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).imported, 1);
});

test('experience batch persists row-level quarantine reasons and evidence limitations', async (t) => {
  const { ExperienceBatchRepository } = await load();
  const root = fixture(t);
  const repo = new ExperienceBatchRepository(root, options);
  const report = await repo.importCsv(Buffer.from('#,项目,主题,工单问题原因\n1,P,a,b\n1,P,c,d\n2,P,e,f'));
  const state = JSON.parse(readFileSync(join(root, 'private', 'state.json'), 'utf8'));
  const rows = state.audits[report.batchId];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].reason, 'duplicate_identity');
  assert.equal(rows[1].outcome, 'quarantined');
  assert.equal(rows[2].outcome, 'imported');
  assert.ok(rows[2].flags.includes('history_partial'));
  assert.equal(rows[2].recordNumber, 3);
});

test('experience batch rejects corrupt date pointers instead of overwriting accepted sources', async (t) => {
  const { ExperienceBatchRepository } = await load();
  const root = fixture(t);
  const repo = new ExperienceBatchRepository(root, options);
  await repo.importCsv(csv());
  const path = join(root, 'private', 'state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  Object.values(state.records)[0].updatedAt = 'not-a-date';
  writeFileSync(path, JSON.stringify(state));
  await assert.rejects(repo.importCsv(csv('new', '2026-09-10 10:00')), /EXPERIENCE_STORE_CORRUPT/);
});
