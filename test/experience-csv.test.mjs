import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const load = () => import('../dist/knowledge/experience/csv/parse.js');
const profileModule = () => import('../dist/knowledge/experience/csv/profile.js');
const bytes = (text) => Buffer.from(text);

test('experience CSV preserves quoted multiline cells and logical record numbers', async () => {
  const { parseExperienceCsv } = await load();
  const parsed = parseExperienceCsv(bytes('\ufeff#,主题,工单问题原因\r\n1,"保存,失败","第一行\r\n第二行"\r\n2,正常,未知\r\n'));
  assert.equal(parsed.encoding, 'utf-8');
  assert.deepEqual(parsed.headers, ['#', '主题', '工单问题原因']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].values['主题'], '保存,失败');
  assert.equal(parsed.rows[0].values['工单问题原因'], '第一行\r\n第二行');
  assert.equal(parsed.rows[1].recordNumber, 2);
  assert.match(parsed.fileHash, /^[a-f0-9]{64}$/);
});

test('experience CSV requires explicit legacy encoding without replacement decoding', async () => {
  const { parseExperienceCsv } = await load();
  const input = Buffer.concat([bytes('#,title\n1,'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4])]);
  assert.throws(() => parseExperienceCsv(input), /CSV_ENCODING_INVALID/);
  assert.equal(parseExperienceCsv(input, { encoding: 'gb18030' }).rows[0].values.title, '中文');
});

test('experience CSV rejects duplicate or empty headers and malformed records with safe errors', async () => {
  const { parseExperienceCsv } = await load();
  for (const input of ['#,主题,主题\n1,a,b', '#,,主题\n1,a,b']) {
    assert.throws(() => parseExperienceCsv(bytes(input)), /CSV_HEADERS_INVALID/);
  }
  for (const input of ['#,主题\n1,a,secret-private-text', '#,主题\n1,"secret-private-text']) {
    assert.throws(() => parseExperienceCsv(bytes(input)), (e) => {
      assert.match(e.message, /CSV_STRUCTURE_INVALID/);
      assert.doesNotMatch(e.message, /secret-private-text/);
      return true;
    });
  }
});

test('experience CSV explicit delimiter and formula text stay literal', async () => {
  const { parseExperienceCsv } = await load();
  const data = parseExperienceCsv(bytes('#;主题\n1;=SUM(A1:A2)'), { delimiter: ';' });
  assert.equal(data.rows[0].values['主题'], '=SUM(A1:A2)');
  assert.throws(() => parseExperienceCsv(bytes('a,b'), { delimiter: 'xx' }), /CSV_OPTIONS_INVALID/);
  assert.throws(() => parseExperienceCsv(bytes('a,b'), { encoding: 'latin1' }), /CSV_OPTIONS_INVALID/);
});

test('experience profile distinguishes placeholders, missing export, duplicate IDs and dates', async () => {
  const { parseExperienceCsv } = await load();
  const { profileExperienceCsv } = await profileModule();
  const input = '#,项目,主题,工单问题原因,问题处理方法与结果,更新于\n1,P,秘密客户甲,未知,单点修复,2026-02-30 10:00\n1,P,秘密客户乙,明确原因,无,2026-09-09 10:00\n2,P,示例,,已恢复,not-date';
  const report = profileExperienceCsv(parseExperienceCsv(bytes(input)));
  assert.equal(report.recordCount, 3);
  assert.equal(report.duplicateIdRecords, 2);
  assert.equal(report.fields.cause.placeholderCount, 1);
  assert.equal(report.fields.cause.emptyCount, 1);
  assert.equal(report.fields.actionAndResult.placeholderCount, 1);
  assert.equal(report.fields.latestNote.completeness, 'not_exported');
  assert.equal(report.fields.updatedAt.invalidDateCount, 2);
  assert.doesNotMatch(JSON.stringify(report), /秘密客户|明确原因|not-date/);
});

test('experience mapping requires available identity columns and rejects ambiguous aliases', async () => {
  const { parseExperienceCsv } = await load();
  const { profileExperienceCsv } = await profileModule();
  assert.throws(() => profileExperienceCsv(parseExperienceCsv(bytes('描述\na'))), /CSV_MAPPING_REQUIRED/);
  assert.throws(() => profileExperienceCsv(parseExperienceCsv(bytes('#,主题,问题原因,工单问题原因\n1,a,b,c'))), /CSV_MAPPING_AMBIGUOUS/);
  const report = profileExperienceCsv(parseExperienceCsv(bytes('编号,标题,问题原因,工单问题原因\n1,a,b,c')), { cause: '工单问题原因' });
  assert.equal(report.fields.cause.column, '工单问题原因');
});

test('experience CSV file limits and empty input fail closed', async () => {
  const { parseExperienceCsv } = await load();
  assert.throws(() => parseExperienceCsv(bytes('')), /CSV_EMPTY/);
  assert.throws(() => parseExperienceCsv(bytes('a\nlong'), { maxBytes: 2 }), /CSV_SIZE_LIMIT/);
  assert.throws(() => parseExperienceCsv(bytes('a\n1\n2'), { maxRecords: 1 }), /CSV_RECORD_LIMIT/);
});

test('experience profile scopes duplicate identity by project and flags missing identity', async () => {
  const { parseExperienceCsv } = await load();
  const { profileExperienceCsv } = await profileModule();
  const report = profileExperienceCsv(parseExperienceCsv(bytes('#,项目,主题\n1,A,a\n1,B,b\n,B,c')));
  assert.equal(report.duplicateIdRecords, 0);
  assert.equal(report.missingIdentityRecords, 1);
});

test('experience CLI profiles local source without configuration or source-value output', () => {
  const root = mkdtempSync(join(tmpdir(), 'experience-cli-'));
  try {
    const input = join(root, 'source.csv');
    writeFileSync(input, '#,主题,工单问题原因\n1,PRIVATE_CUSTOMER,PRIVATE_CAUSE');
    const result = spawnSync(process.execPath, ['dist/cli.js', 'experience', 'profile', '--file', input], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).recordCount, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_CUSTOMER|PRIVATE_CAUSE/);
    const wrong = spawnSync(process.execPath, ['dist/cli.js', 'experience', 'profile', '--file', input, '--bogus'], { encoding: 'utf8' });
    assert.notEqual(wrong.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('experience file reader validates limits before allocating or opening paths', async () => {
  const { readExperienceCsv } = await import('../dist/knowledge/experience/csv/read.js');
  for (const maxBytes of [-1, NaN, Infinity, 0]) {
    await assert.rejects(readExperienceCsv('/nonexistent-sensitive-path', { maxBytes }), /CSV_OPTIONS_INVALID/);
  }
  await assert.rejects(readExperienceCsv('/nonexistent-sensitive-path'), (error) => {
    assert.equal(error.message, 'CSV_FILE_UNREADABLE');
    return true;
  });
});

test('experience CLI rejects FIFO input instead of blocking at open', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'experience-fifo-'));
  try {
    const fifo = join(root, 'source.csv');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const result = spawnSync(process.execPath, ['dist/cli.js', 'experience', 'profile', '--file', fifo], { encoding: 'utf8', timeout: 2000 });
    assert.equal(result.signal, null, 'non-regular input must fail without an open timeout');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CSV_FILE_UNREADABLE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
