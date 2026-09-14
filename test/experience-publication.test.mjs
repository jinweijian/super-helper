import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const options = { scope: 'fixture', sourceInstance: 'fixture-redmine' };
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'experience-publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { ExperienceBatchRepository } = await import('../dist/knowledge/experience/batch-repository.js');
  const batch = new ExperienceBatchRepository(root, options);
  await batch.importCsv(Buffer.from('#,项目,主题,工单问题原因\n7,P,接口失败,请求被拦截'));
  const source = batch.listPending()[0].source;
  const { hashExperienceDraft } = await import('../dist/knowledge/experience/artifact.js');
  const { sourceRevision } = await import('../dist/knowledge/experience/provenance.js');
  const draft = { title: '请求拦截线索', kind: 'diagnostic_lead', evidenceGrade: 'lead_only', claims: [
    { id: 'C1', section: 'cause', text: '来源报告请求被拦截', classification: 'source_reported', execution: 'not_applicable', citations: [{ field: 'cause', quote: '请求被拦截' }] },
  ] };
  const review = { draftHash: hashExperienceDraft(draft), sourceRevision: sourceRevision(source), verdict: 'accepted', privacyPassed: true,
    titleSupported: true, kindSupported: true, evidenceGradeSupported: true, claims: [{ claimId: 'C1', verdict: 'supported' }] };
  const { ExperiencePublicationRepository } = await import('../dist/knowledge/experience/publication-repository.js');
  return { root, source, draft, review, repo: new ExperiencePublicationRepository(root, options) };
}
test('experience publication commits reviewed markdown and sidecar with idempotent revision', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.repo.list(), []);
  const first = f.repo.publish(f.source, f.draft, f.review);
  assert.equal(first.revision, 1);
  assert.deepEqual(f.repo.publish(f.source, f.draft, f.review), first);
  const published = f.repo.list();
  assert.equal(published.length, 1);
  assert.match(published[0].markdown, /来源报告请求被拦截/);
  assert.equal(published[0].sidecar.claims[0].text, f.draft.claims[0].text);
});

test('experience publication rejects a missing manifest instead of silently adopting an empty library', async t => {
  const f = await fixture(t);
  f.repo.publish(f.source, f.draft, f.review);
  unlinkSync(join(f.root, 'private', 'publication.json'));
  assert.throws(() => f.repo.list(), /EXPERIENCE_PUBLICATION_CORRUPT/);
  assert.throws(() => f.repo.publish(f.source, f.draft, f.review), /EXPERIENCE_PUBLICATION_CORRUPT/);
});
test('experience publication rejects modified markdown and invalid review', async t => {
  const f = await fixture(t);
  assert.throws(() => f.repo.publish(f.source, f.draft, { ...f.review, verdict: 'rejected' }), /EXPERIENCE_REVIEW_INVALID/);
  assert.deepEqual(f.repo.list(), []);
  const entry = f.repo.publish(f.source, f.draft, f.review);
  writeFileSync(join(f.root, 'vault', entry.objectId, 'experience.md'), 'tampered');
  assert.throws(() => f.repo.list(), /EXPERIENCE_PUBLICATION_CORRUPT/);
});
test('experience publication ignores uncommitted revisions and withdrawal hides published material', async t => {
  const f = await fixture(t);
  const entry = f.repo.publish(f.source, f.draft, f.review);
  const manifestPath = join(f.root, 'private', 'publication.json');
  const original = readFileSync(manifestPath, 'utf8');
  writeFileSync(manifestPath, JSON.stringify({ version: 1, entries: {} }));
  assert.deepEqual(f.repo.list(), []);
  writeFileSync(manifestPath, original);
  f.repo.withdraw(entry.experienceId);
  assert.deepEqual(f.repo.list(), []);
  assert.throws(() => f.repo.publish(f.source, f.draft, f.review), /EXPERIENCE_PUBLICATION_WITHDRAWN/);
});

test('experience publication survives process exit immediately before and after manifest commit', async t => {
  const f = await fixture(t);
  f.repo.publish(f.source, f.draft, f.review);
  const { hashExperienceDraft } = await import('../dist/knowledge/experience/artifact.js');
  const { recoverDeadExperienceLock } = await import('../dist/knowledge/experience/store-lock.js');
  const payload = join(f.root, 'private', 'crash-fixture.json');
  const url = pathToFileURL(resolve('dist/knowledge/experience/publication-repository.js')).href;
  let expectedRevision = 1;
  for (const mode of ['before', 'after']) {
    const draft = { ...f.draft, title: `请求拦截线索-${mode}` };
    const review = { ...f.review, draftHash: hashExperienceDraft(draft) };
    writeFileSync(payload, JSON.stringify({ source: f.source, draft, review }), { mode: 0o600 });
    const script = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const original = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (String(to).endsWith('/private/publication.json')) {
          if (process.argv[2] === 'before') process.exit(73);
          original(from, to); process.exit(74);
        }
        return original(from, to);
      };
      syncBuiltinESMExports();
      const { ExperiencePublicationRepository } = await import(${JSON.stringify(url)});
      const value = JSON.parse(fs.readFileSync(process.argv[1] + '/private/crash-fixture.json', 'utf8'));
      new ExperiencePublicationRepository(process.argv[1], ${JSON.stringify(options)}).publish(value.source, value.draft, value.review);
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, f.root, mode], { encoding: 'utf8' });
    assert.equal(child.status, mode === 'before' ? 73 : 74, child.stderr);
    if (mode === 'after') expectedRevision++;
    assert.equal(f.repo.list()[0].revision, expectedRevision);
    recoverDeadExperienceLock(join(f.root, 'private', 'writer.lock'));
    const published = f.repo.publish(f.source, draft, review);
    if (mode === 'before') expectedRevision++;
    assert.equal(published.revision, expectedRevision);
    assert.equal(f.repo.list().length, 1);
  }
});
