import type { ExperienceArtifact, ExperienceEvidenceReference } from './contracts.js';
import { validateExperienceArtifact } from './artifact-validation.js';
import { experienceSections } from './schema.js';
import { escapeExperienceMarkdown as escape, hasSensitiveExperienceText } from './privacy.js';
import { experienceIdentity, sha256, sourceRevision } from './provenance.js';
export { hashExperienceDraft } from './artifact-validation.js';

const headings = {
  summary: '一句话摘要', symptom: '现象与触发条件', applicability: '适用范围与不适用情况',
  cause: '原因与证据', action: '处理步骤', verification: '验证与结果', counterevidence: '已排除项与反证',
  unknown: '未知', next_check: '下一次排查检查项',
};
const classifications = { source_reported: '来源记录', inference: '推断', unknown: '未知', recommendation: '新建议（非历史执行）' };

export function renderExperienceArtifact(sourceInput: unknown, draftInput: unknown, reviewInput: unknown, revision: number): ExperienceArtifact {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('EXPERIENCE_REVISION_INVALID');
  const { source, draft, review } = validateExperienceArtifact(sourceInput, draftInput, reviewInput);
  const experienceId = experienceIdentity(source);
  const sourceHash = sourceRevision(source);
  const reviewRecordId = `review-${sha256(JSON.stringify(review))}`;
  const sources: ExperienceEvidenceReference[] = [];
  const claims = draft.claims.map((claim) => ({
    ...claim,
    evidenceIds: claim.citations.map((citation) => {
      const existing = sources.find((item) => item.field === citation.field && item.quote === citation.quote);
      if (existing) return existing.id;
      const cell = source.fields[citation.field]!;
      const id = `E${sources.length + 1}`;
      sources.push({ id, field: citation.field, quote: citation.quote, column: cell.column,
        rawHash: cell.rawHash, fileHash: source.fileHash, recordNumber: source.recordNumber });
      return id;
    }),
  }));
  const attributeValues = (attribute: string) => claims.filter((claim) => claim.attribute === attribute).map((claim) => claim.text);
  const lines = [
    '---', 'schema_version: experience/v1', `experience_id: ${experienceId}`, `revision: ${revision}`,
    `title: ${JSON.stringify(draft.title)}`, 'source_type: redmine_csv', `kind: ${draft.kind}`,
    'lifecycle: published', `evidence_grade: ${draft.evidenceGrade}`,
    `product: ${JSON.stringify(attributeValues('product')[0] ?? null)}`, `module: ${JSON.stringify(attributeValues('module')[0] ?? null)}`,
    `affected_versions: ${JSON.stringify(attributeValues('affected_version'))}`, `fixed_versions: ${JSON.stringify(attributeValues('fixed_version'))}`,
    `symptom_terms: ${JSON.stringify(attributeValues('symptom_term'))}`, `applicability: ${JSON.stringify(attributeValues('applicability'))}`,
    `exclusions: ${JSON.stringify(attributeValues('exclusion'))}`, 'relations: []', `review_record_id: ${reviewRecordId}`,
    `source_refs: ${JSON.stringify(sources.map((item) => item.id))}`, '---', '', `# ${escape(draft.title)}`, '',
  ];
  for (const section of experienceSections) {
    lines.push(`## ${headings[section]}`, '');
    const selected = claims.filter((claim) => claim.section === section);
    if (!selected.length) lines.push('未提供；不得据此认定不存在。', '');
    for (const claim of selected) {
      const execution = claim.execution === 'performed' ? '；历史已执行' : claim.execution === 'proposed' ? '；仅建议/计划' : '';
      lines.push(`- ${classifications[claim.classification]}${execution}：${escape(claim.text)} ${claim.evidenceIds.map((id) => `[${id}]`).join('')}`.trimEnd(), '');
    }
  }
  lines.push('## 证据与来源', '');
  for (const item of sources) lines.push(`- ${item.id}：源快照 ${item.fileHash}，逻辑记录 ${item.recordNumber}，字段「${escape(item.column)}」；原值哈希 ${item.rawHash}。支持片段：${escape(item.quote)}`, '');
  lines.push('## 关联经验', '', '尚未建立。', '');
  const markdown = lines.join('\n');
  if (hasSensitiveExperienceText(markdown) || hasSensitiveExperienceText(JSON.stringify(sources))) throw new Error('EXPERIENCE_PRIVACY_FAILED');
  return { experienceId, revision, sourceRevision: sourceHash, markdown, contentHash: sha256(markdown),
    sidecar: { schemaVersion: 'experience/v1', experienceId, revision, sourceRevision: sourceHash, reviewRecordId, claims, sources } };
}
