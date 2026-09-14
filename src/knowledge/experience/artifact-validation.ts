import type { ExperienceDraft, ExperienceReview, ExperienceSource } from './contracts.js';
import { experienceDraftSchema, experienceReviewSchema, experienceSourceSchema } from './schema.js';
import { sha256, sourceRevision } from './provenance.js';
import { hasSensitiveExperienceText } from './privacy.js';

export function hashExperienceDraft(draft: ExperienceDraft): string {
  const parsed = experienceDraftSchema.safeParse(draft);
  if (!parsed.success) throw new Error('EXPERIENCE_DRAFT_INVALID');
  return sha256(JSON.stringify(parsed.data));
}

export function validateExperienceArtifact(sourceInput: unknown, draftInput: unknown, reviewInput: unknown): {
  source: ExperienceSource; draft: ExperienceDraft; review: ExperienceReview;
} {
  const s = experienceSourceSchema.safeParse(sourceInput);
  const d = experienceDraftSchema.safeParse(draftInput);
  if (!s.success || !d.success) throw new Error('EXPERIENCE_SCHEMA_INVALID');
  const source = s.data;
  const draft = d.data;
  if (hasSensitiveExperienceText(JSON.stringify(draft))) throw new Error('EXPERIENCE_PRIVACY_FAILED');
  if (new Set(draft.claims.map((claim) => claim.id)).size !== draft.claims.length) throw new Error('EXPERIENCE_CLAIMS_INVALID');
  for (const claim of draft.claims) {
    if (claim.classification === 'source_reported' && !claim.citations.length) throw new Error('EXPERIENCE_SOURCE_REQUIRED');
    if (claim.execution === 'performed' && (claim.classification !== 'source_reported' || claim.section !== 'action')) throw new Error('EXPERIENCE_EXECUTION_INVALID');
    if (claim.classification === 'recommendation' && claim.execution === 'performed') throw new Error('EXPERIENCE_EXECUTION_INVALID');
    if (claim.attribute) {
      if (claim.classification !== 'source_reported' || !claim.citations.length) throw new Error('EXPERIENCE_METADATA_INVALID');
      const versionField = claim.attribute === 'affected_version' ? 'affectedVersion'
        : claim.attribute === 'fixed_version' ? 'fixedVersion' : undefined;
      if (versionField && !claim.citations.some((citation) => citation.field === versionField && citation.quote.includes(claim.text))) {
        throw new Error('EXPERIENCE_VERSION_INVALID');
      }
    }
    for (const citation of claim.citations) {
      const cell = source.fields[citation.field];
      if (!cell || !cell.value.includes(citation.quote) || cell.completeness === 'empty'
          || cell.completeness === 'suspected_truncated') throw new Error('EXPERIENCE_SOURCE_INVALID');
    }
  }
  for (const attribute of ['product', 'module']) {
    if (draft.claims.filter((claim) => claim.attribute === attribute).length > 1) throw new Error('EXPERIENCE_METADATA_INVALID');
  }
  if (!draft.claims.some((claim) => claim.citations.length && claim.classification !== 'unknown')) throw new Error('EXPERIENCE_SOURCE_REQUIRED');
  if (draft.evidenceGrade === 'source_verified' && !draft.claims.some((claim) =>
    claim.section === 'verification' && claim.classification === 'source_reported'
      && claim.citations.some((citation) => citation.field !== 'status'))) throw new Error('EXPERIENCE_VERIFICATION_REQUIRED');
  if (draft.kind === 'root_cause_case' && !draft.claims.some((claim) => claim.section === 'cause'
      && claim.classification === 'source_reported' && claim.citations.length)) throw new Error('EXPERIENCE_CAUSE_REQUIRED');
  const r = experienceReviewSchema.safeParse(reviewInput);
  if (!r.success) throw new Error('EXPERIENCE_REVIEW_INVALID');
  const review = r.data;
  if (review.verdict !== 'accepted' || !review.privacyPassed || !review.titleSupported || !review.kindSupported
      || !review.evidenceGradeSupported || review.draftHash !== hashExperienceDraft(draft)
      || review.sourceRevision !== sourceRevision(source)
      || review.claims.length !== draft.claims.length
      || new Set(review.claims.map((claim) => claim.claimId)).size !== draft.claims.length
      || draft.claims.some((claim) => !review.claims.some((item) => item.claimId === claim.id && item.verdict === 'supported'))) {
    throw new Error('EXPERIENCE_REVIEW_INVALID');
  }
  return { source, draft, review };
}
