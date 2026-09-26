import type { DiagnosticClaim } from '../domain.js';
import type { AnswerCoverageReview } from './answer-coverage.js';

export function reviewedBindingClaimIds(
  review: AnswerCoverageReview | undefined,
  claims: DiagnosticClaim[],
  acceptedClaimIds: string[],
): string[] {
  if (!review) {
    const accepted = new Set(acceptedClaimIds);
    return claims.filter((claim) => (
      claim.id && accepted.has(claim.id) &&
      (claim.type === 'fact' || claim.type === 'inference') &&
      claim.evidenceIds.length > 0
    )).map((claim) => claim.id!);
  }
  if (review.status !== 'accepted') return [];
  return Array.from(new Set(review.bindings.map((binding) => binding.claimId)));
}
