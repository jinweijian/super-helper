import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, rmdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const scope = { scope: 'fixture', sourceInstance: 'redmine-fixture' };
async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'experience-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { ExperienceBatchRepository } = await import('../dist/knowledge/experience/batch-repository.js');
  await new ExperienceBatchRepository(root, scope).importCsv(Buffer.from('#,项目,主题,工单问题原因\n7,P,失败,请求拦截\n8,P,失败,请求拦截'));
  const { refineExperienceBatch } = await import('../dist/application/experience-refinement/refine-batch.js');
  return { root, refineExperienceBatch };
}
function model(counter) { return { async complete(messages) {
  counter.calls++;
  const input = JSON.parse(messages[1].content);
  if (input.draft) return JSON.stringify({ draftHash: input.draftHash, sourceRevision: input.sourceRevision, verdict: 'accepted', privacyPassed: true,
    titleSupported: true, kindSupported: true, evidenceGradeSupported: true, claims: [{ claimId: 'C1', verdict: 'supported' }] });
  return JSON.stringify({ title: '请求拦截线索', kind: 'diagnostic_lead', evidenceGrade: 'lead_only', claims: [
    { id: 'C1', section: 'cause', text: '来源报告请求拦截', classification: 'source_reported', execution: 'not_applicable', citations: [{ field: 'cause', quote: '请求拦截' }] },
  ] });
} }; }
test('experience batch refinement imports through publication and skips completed work on restart', async t => {
  const { root, refineExperienceBatch } = await setup(t);
  const counter = { calls: 0 };
  const input = { root, scope, jobId: 'pilot', modelFingerprint: 'fake-v1', maxCalls: 4, model: model(counter) };
  const first = await refineExperienceBatch(input);
  assert.equal(first.published, 2);
  assert.equal(first.callsUsed, 4);
  assert.equal((await refineExperienceBatch(input)).published, 2);
  assert.equal(counter.calls, 4);
  const { ExperiencePublicationRepository } = await import('../dist/knowledge/experience/publication-repository.js');
  assert.equal(new ExperiencePublicationRepository(root, scope).list().length, 2);
  await refineExperienceBatch({ ...input, jobId: 'next-increment' });
  assert.equal(counter.calls, 4, 'new job must reuse already published source revisions');
});
test('experience batch refinement persists exhausted budget instead of resetting it on restart', async t => {
  const { root, refineExperienceBatch } = await setup(t);
  const counter = { calls: 0 };
  const input = { root, scope, jobId: 'limited', modelFingerprint: 'fake-v1', maxCalls: 2, model: model(counter) };
  assert.equal((await refineExperienceBatch(input)).published, 1);
  const second = await refineExperienceBatch(input);
  assert.equal(second.status, 'paused');
  assert.equal(second.callsUsed, 2);
  assert.equal(counter.calls, 2);
  await assert.rejects(refineExperienceBatch({ ...input, maxCalls: 4 }), /EXPERIENCE_JOB_CONFIG_MISMATCH/);
  const status = spawnSync(process.execPath, ['dist/cli.js', 'experience', 'status', '--store', root,
    '--scope', scope.scope, '--source-instance', scope.sourceInstance, '--job', 'limited'], { encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  const report = JSON.parse(status.stdout);
  assert.equal(report.callsUsed, 2);
  assert.equal(report.remainingCalls, 0);
  assert.equal(report.published, 1);
  assert.equal(report.execution, 'unknown');
  assert.equal(counter.calls, 2);
  const { sha256 } = await import('../dist/knowledge/experience/provenance.js');
  unlinkSync(join(root, 'private', 'refinement', sha256('limited'), 'job.json'));
  await assert.rejects(refineExperienceBatch(input), /EXPERIENCE_JOB_CORRUPT/);
  assert.equal(counter.calls, 2);
});

test('experience batch refinement resumes accepted checkpoint after publication failure without another model call', async t => {
  const { root, refineExperienceBatch } = await setup(t);
  const counter = { calls: 0 };
  const input = { root, scope, jobId: 'publish-retry', modelFingerprint: 'fake-v1', maxCalls: 2, model: model(counter) };
  const lock = join(root, 'private', 'writer.lock');
  mkdirSync(lock, { mode: 0o700 });
  await assert.rejects(refineExperienceBatch(input), /EXPERIENCE_STORE_BUSY/);
  assert.equal(counter.calls, 2);
  rmdirSync(lock);
  const resumed = await refineExperienceBatch(input);
  assert.equal(resumed.published, 1);
  assert.equal(resumed.callsUsed, 2);
  assert.equal(counter.calls, 2);
});

test('experience refine CLI requires opt-in and executes the configured model publication path', async t => {
  const { root } = await setup(t);
  const counter = { calls: 0 };
  const fake = model(counter);
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const content = await fake.complete(body.messages);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const config = join(root, 'fixture-config.json');
  writeFileSync(config, JSON.stringify({ storage: { rootDir: root }, agent: { modelProvider: 'fixture' },
    models: { providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'fixture', apiKeyEnv: 'EXPERIENCE_FIXTURE_KEY' } } } }));
  const run = (enabled) => new Promise(resolve => {
    const child = spawn(process.execPath, ['dist/cli.js', 'experience', 'refine', '--store', root, '--scope', scope.scope,
      '--source-instance', scope.sourceInstance, '--job', 'cli-pilot', '--max-calls', '4', '--config', config, '--enable-model', enabled],
    { env: { ...process.env, EXPERIENCE_FIXTURE_KEY: 'synthetic-test-only' } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const denied = await run('false');
  assert.notEqual(denied.code, 0);
  assert.match(denied.stderr, /EXPERIENCE_MODEL_OPT_IN_REQUIRED/);
  assert.equal(counter.calls, 0);
  const allowed = await run('true');
  assert.equal(allowed.code, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).published, 2);
  assert.equal(counter.calls, 4);
});
