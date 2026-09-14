import assert from 'node:assert/strict';
import test from 'node:test';

const load = () => import('../dist/knowledge/experience/artifact.js');
const provenance = () => import('../dist/knowledge/experience/provenance.js');
const source = {
  scope: 'test-workspace', sourceInstance: 'test-redmine', sourceProject: 'test-project', ticketId: '7',
  fileHash: 'a'.repeat(64), recordNumber: 2,
  fields: {
    cause: { column: '原因', value: '校验接口被拦截', rawHash: 'b'.repeat(64), completeness: 'present' },
    actionAndResult: { column: '处理', value: '加入白名单后来源报告恢复', rawHash: 'c'.repeat(64), completeness: 'present' },
  },
};
const draft = {
  title: '接口拦截导致保存失败的历史处理线索', kind: 'recovery_procedure', evidenceGrade: 'source_reported',
  claims: [
    { id: 'C1', section: 'cause', text: '来源报告校验接口被拦截。', classification: 'source_reported', execution: 'not_applicable', citations: [{ field: 'cause', quote: '校验接口被拦截' }] },
    { id: 'C2', section: 'action', text: '来源记录加入白名单。', classification: 'source_reported', execution: 'performed', citations: [{ field: 'actionAndResult', quote: '加入白名单' }] },
    { id: 'C3', section: 'unknown', text: '具体复测过程未知。', classification: 'unknown', execution: 'not_applicable', citations: [] },
  ],
};
async function accepted(value) {
  const { hashExperienceDraft } = await load();
  const { sourceRevision } = await provenance();
  return { draftHash: hashExperienceDraft(value), sourceRevision: sourceRevision(source), verdict: 'accepted', privacyPassed: true,
    titleSupported: true, kindSupported: true, evidenceGradeSupported: true,
    claims: value.claims.map((claim) => ({ claimId: claim.id, verdict: 'supported' })) };
}

test('experience identity is independent of filename, record order and title', async () => {
  const { experienceIdentity, sourceRevision } = await provenance();
  assert.equal(experienceIdentity(source), experienceIdentity({ ...source, recordNumber: 100, fileHash: 'd'.repeat(64) }));
  assert.notEqual(experienceIdentity(source), experienceIdentity({ ...source, scope: 'other' }));
  assert.notEqual(experienceIdentity(source), experienceIdentity({ ...source, ticketId: '8' }));
  assert.equal(sourceRevision(source), sourceRevision({ ...source, fileHash: 'e'.repeat(64), recordNumber: 9 }));
});

test('experience source revisions canonicalize cell key order and identity whitespace', async () => {
  const { experienceIdentity, sourceRevision } = await provenance();
  const reordered = structuredClone(source);
  reordered.fields.cause = { value: source.fields.cause.value, rawHash: source.fields.cause.rawHash,
    completeness: 'present', column: '原因' };
  assert.equal(sourceRevision(reordered), sourceRevision(source));
  assert.equal(experienceIdentity({ ...source, scope: ' test-workspace ' }), experienceIdentity(source));
  const { renderExperienceArtifact } = await load();
  const review = await accepted(draft);
  review.sourceRevision = sourceRevision(reordered);
  assert.doesNotThrow(() => renderExperienceArtifact(reordered, draft, review, 1));
});

test('experience privacy gate rejects quoted JSON and YAML credentials in source-backed claims', async () => {
  const { renderExperienceArtifact } = await load();
  const { sourceRevision } = await provenance();
  for (const key of ['password', 'api_key', 'token']) {
    for (const snippet of [`{"${key}":"demo-secret-123"}`, `'${key}': 'demo-secret-123'`]) {
      const badSource = structuredClone(source);
      badSource.fields.cause.value = snippet;
      const badDraft = structuredClone(draft);
      badDraft.claims[0].text = snippet;
      badDraft.claims[0].citations[0].quote = snippet;
      const review = await accepted(badDraft);
      review.sourceRevision = sourceRevision(badSource);
      assert.throws(() => renderExperienceArtifact(badSource, badDraft, review, 1), /EXPERIENCE_PRIVACY_FAILED/);
    }
  }
});

test('experience privacy keeps exact redacted placeholders usable through Markdown escaping', async () => {
  const { renderExperienceArtifact } = await load();
  const { sourceRevision } = await provenance();
  for (const snippet of ['password=[已脱敏]', 'password=[已脱敏]追加秘密']) {
    const redactedSource = structuredClone(source);
    redactedSource.fields.cause.value = snippet;
    redactedSource.fields.cause.completeness = 'redacted';
    const redactedDraft = structuredClone(draft);
    redactedDraft.claims[0].text = snippet;
    redactedDraft.claims[0].citations[0].quote = snippet;
    const review = await accepted(redactedDraft);
    review.sourceRevision = sourceRevision(redactedSource);
    if (snippet.endsWith('追加秘密')) {
      assert.throws(() => renderExperienceArtifact(redactedSource, redactedDraft, review, 1), /EXPERIENCE_PRIVACY_FAILED/);
    } else {
      assert.doesNotThrow(() => renderExperienceArtifact(redactedSource, redactedDraft, review, 1));
    }
  }
});

test('experience artifact renders reviewed claims and same-source sidecar with provenance', async () => {
  const { renderExperienceArtifact } = await load();
  const result = renderExperienceArtifact(source, draft, await accepted(draft), 1);
  assert.match(result.markdown, /schema_version: experience\/v1/);
  assert.match(result.markdown, /## 验证与结果/);
  assert.match(result.markdown, /未提供/);
  assert.equal(result.sidecar.claims[0].text, draft.claims[0].text);
  assert.match(result.markdown, /来源报告校验接口被拦截/);
  assert.match(result.markdown, /\[E1\]/);
  assert.equal(result.sidecar.sources[0].recordNumber, 2);
  assert.equal(result.sidecar.sources[0].column, '原因');
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test('experience artifact fails closed for forged quotes, stale review and unsupported claims', async () => {
  const { renderExperienceArtifact } = await load();
  const invented = structuredClone(draft);
  invented.claims[0].citations[0].quote = '不存在的验证';
  assert.throws(() => renderExperienceArtifact(source, invented, {}, 1), /EXPERIENCE_/);
  const review = await accepted(draft);
  const changed = { ...draft, title: '篡改标题' };
  assert.throws(() => renderExperienceArtifact(source, changed, review, 1), /EXPERIENCE_REVIEW_INVALID/);
  review.claims[0].verdict = 'unsupported';
  assert.throws(() => renderExperienceArtifact(source, draft, review, 1), /EXPERIENCE_REVIEW_INVALID/);
  assert.throws(() => renderExperienceArtifact(source, invented, { ...review, draftHash: 'a'.repeat(64) }, 1), /EXPERIENCE_/);
});

test('experience review is also bound to source revision, not just identical quoted text', async () => {
  const { renderExperienceArtifact } = await load();
  const review = await accepted(draft);
  const changedSource = structuredClone(source);
  changedSource.fields.cause.rawHash = 'f'.repeat(64);
  assert.throws(() => renderExperienceArtifact(changedSource, draft, review, 1), /EXPERIENCE_REVIEW_INVALID/);
});

test('experience metadata derives from reviewed claims and never promotes target version', async () => {
  const { renderExperienceArtifact } = await load();
  const { sourceRevision } = await provenance();
  const versionSource = structuredClone(source);
  versionSource.fields.targetVersion = { column: '目标版本', value: '26.4', rawHash: 'd'.repeat(64), completeness: 'present' };
  const versionDraft = structuredClone(draft);
  versionDraft.claims.push({ id: 'C4', section: 'applicability', attribute: 'affected_version', text: '26.4', classification: 'source_reported', execution: 'not_applicable', citations: [{ field: 'targetVersion', quote: '26.4' }] });
  const review = await accepted(versionDraft);
  review.sourceRevision = sourceRevision(versionSource);
  assert.throws(() => renderExperienceArtifact(versionSource, versionDraft, review, 1), /EXPERIENCE_VERSION_INVALID/);
  versionSource.fields.affectedVersion = { ...versionSource.fields.targetVersion, column: '受影响版本' };
  versionDraft.claims[3].citations[0].field = 'affectedVersion';
  const corrected = await accepted(versionDraft);
  corrected.sourceRevision = sourceRevision(versionSource);
  assert.match(renderExperienceArtifact(versionSource, versionDraft, corrected, 1).markdown, /affected_versions: \["26.4"\]/);
});

test('experience artifact cannot promote recovery to verified cause or perform recommendations', async () => {
  const { renderExperienceArtifact } = await load();
  const promoted = { ...draft, evidenceGrade: 'source_verified', kind: 'root_cause_case' };
  const review = await accepted(promoted);
  assert.throws(() => renderExperienceArtifact(source, promoted, review, 1), /EXPERIENCE_VERIFICATION_REQUIRED/);
  const wrong = structuredClone(draft);
  wrong.claims[1].classification = 'recommendation';
  assert.throws(() => renderExperienceArtifact(source, wrong, {}, 1), /EXPERIENCE_/);
});

test('experience artifact refuses private output and source metadata cannot supply unchecked versions', async () => {
  const { renderExperienceArtifact } = await load();
  const privateDraft = { ...draft, title: 'password=super-secret' };
  assert.throws(() => renderExperienceArtifact(source, privateDraft, {}, 1), /EXPERIENCE_/);
  const versionSource = { ...source, fields: { ...source.fields, targetVersion: { column: '目标版本', value: '26.4', rawHash: 'd'.repeat(64), completeness: 'present' } } };
  const review = await accepted(draft);
  review.sourceRevision = (await provenance()).sourceRevision(versionSource);
  const result = renderExperienceArtifact(versionSource, draft, review, 1);
  assert.match(result.markdown, /affected_versions: \[\]/);
  assert.match(result.markdown, /fixed_versions: \[\]/);
});
