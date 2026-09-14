import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExperienceCsv } from '../dist/knowledge/experience/csv/parse.js';

const scope = { scope: 'workspace-test', sourceInstance: 'redmine-test' };
const parsed = (text) => parseExperienceCsv(Buffer.from(text));
const load = () => import('../dist/knowledge/experience/csv/normalize.js');

test('experience normalization keeps truncation uncertainty after redacting sensitive text', async () => {
  const { normalizeExperienceCsv } = await load();
  const rows = normalizeExperienceCsv(parsed('#,项目,主题,工单问题原因\n7,P,失败,接口拦截 user@example.com 后续…'), scope);
  assert.equal(rows[0].source.fields.cause.completeness, 'suspected_truncated');
  assert.doesNotMatch(rows[0].source.fields.cause.value, /user@example/);
});

test('experience normalization preserves technical evidence but excludes identity columns and credentials', async () => {
  const { normalizeExperienceCsv } = await load();
  const csv = parsed('#,项目,主题,作者,工单问题原因,问题处理方法与结果,文件\n7,P,甲客户保存失败,张三,张三检查 /register/email/check 被拦截,修改白名单 password=secret-123,screenshot.png');
  const result = normalizeExperienceCsv(csv, { ...scope, redactTerms: ['甲客户'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'ready');
  assert.match(result[0].source.fields.cause.value, /\/register\/email\/check/);
  const output = JSON.stringify(result[0].source.fields);
  assert.doesNotMatch(output, /张三|甲客户|secret-123|screenshot.png/);
  assert.equal(result[0].source.fields.title.completeness, 'redacted');
  assert.match(result[0].source.fields.cause.rawHash, /^[a-f0-9]{64}$/);
  assert.ok(result[0].flags.includes('attachments_not_exported'));
});

test('experience normalization quarantines all duplicate IDs and missing identity without corrupting other records', async () => {
  const { normalizeExperienceCsv } = await load();
  const result = normalizeExperienceCsv(parsed('#,项目,主题,工单问题原因\n1,P,a,b\n1,P,a,c\n2,P,d,e\n,P,f,g'), scope);
  assert.deepEqual(result.map((item) => item.status), ['quarantined', 'quarantined', 'ready', 'quarantined']);
  assert.deepEqual(result.map((item) => item.reason), ['duplicate_identity', 'duplicate_identity', undefined, 'missing_identity']);
});

test('experience normalization distinguishes exported empty and not-exported fields and does not elevate status', async () => {
  const { normalizeExperienceCsv } = await load();
  const [result] = normalizeExperienceCsv(parsed('#,项目,主题,工单问题原因,状态\n1,P,a,,已解决'), scope);
  assert.equal(result.source.fields.cause.completeness, 'empty');
  assert.equal(result.source.fields.latestNote, undefined);
  assert.ok(result.flags.includes('history_partial'));
  assert.equal(result.source.fields.status.value, '已解决');
  assert.equal(result.source.evidenceGrade, undefined);
});

test('experience normalization requires trusted scope and explicit project if absent from CSV', async () => {
  const { normalizeExperienceCsv } = await load();
  assert.throws(() => normalizeExperienceCsv(parsed('#,主题\n1,a'), { scope: '', sourceInstance: 'r' }), /EXPERIENCE_IMPORT_OPTIONS_INVALID/);
  assert.equal(normalizeExperienceCsv(parsed('#,主题\n1,a'), scope)[0].reason, 'missing_identity');
  assert.equal(normalizeExperienceCsv(parsed('#,主题\n1,a'), { ...scope, sourceProject: 'P' })[0].source.sourceProject, 'P');
});

test('experience normalization preserves long notes and flags invalid dates', async () => {
  const { normalizeExperienceCsv } = await load();
  const note = '日志'.repeat(20_000);
  const [result] = normalizeExperienceCsv(parsed(`#,项目,主题,最近批注,更新于\n1,P,a,${note},2026-02-30 10:00`), scope);
  assert.equal(result.status, 'quarantined');
  assert.equal(result.reason, 'invalid_date');
  assert.equal(result.source.fields.latestNote.value.length, 40_000);
});
