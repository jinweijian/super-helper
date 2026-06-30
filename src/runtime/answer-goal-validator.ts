import type { AnswerGoal, DiagnosticClaim } from '../domain.js';
import { primaryAnswerItems } from './answer-goal.js';

export function primaryAnswerClaimIds(claims: DiagnosticClaim[], answerGoal?: AnswerGoal): string[] {
  if (!answerGoal) {
    return claims
      .filter((claim) => claim.role === 'primary_answer')
      .flatMap((claim) => claim.id ? [claim.id] : []);
  }
  const required = primaryAnswerItems(answerGoal);
  return claims
    .filter((claim) => (
      claim.role === 'primary_answer' &&
      (claim.type === 'fact' || claim.type === 'inference') &&
      required.every((item) => claim.answers.includes(item))
    ))
    .flatMap((claim) => claim.id ? [claim.id] : []);
}

