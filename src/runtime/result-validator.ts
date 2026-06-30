import type { AnswerGoal, DiagnosticClaim, DiagnosticClaimRole, DiagnosticResult, Evidence } from '../domain.js';
import { primaryAnswerClaimIds } from './answer-goal-validator.js';

export interface DiagnosticValidationIssue {
  code:
    | 'duplicate_evidence_id'
    | 'missing_evidence_reference'
    | 'low_confidence_fact'
    | 'invalid_claim_type'
    | 'missing_claim_role'
    | 'invalid_claim_role'
    | 'missing_claim_answers'
    | 'missing_primary_answer'
    | 'primary_answer_misses_goal'
    | 'unsupported_claim';
  claimId?: string;
  evidenceId?: string;
  message: string;
}

export interface ValidatedDiagnosticResult {
  result: DiagnosticResult;
  issues: DiagnosticValidationIssue[];
  acceptedClaimIds: string[];
  rejectedClaimIds: string[];
  primaryAnswerClaimIds: string[];
}

export interface ValidateDiagnosticResultOptions {
  additionalEvidence?: Evidence[];
  answerGoal?: AnswerGoal;
}

export function validateDiagnosticResult(
  result: DiagnosticResult,
  options: ValidateDiagnosticResultOptions = {},
): ValidatedDiagnosticResult {
  const issues: DiagnosticValidationIssue[] = [];
  const evidence = mergeReferencedAdditionalEvidence(result, options.additionalEvidence ?? [], issues);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const claims: DiagnosticClaim[] = [];
  const rejectedClaimIds: string[] = [];

  result.claims.forEach((claim, index) => {
    const id = claim.id ?? `claim_${index + 1}`;
    if (!['fact', 'inference', 'assumption', 'unknown'].includes(claim.type)) {
      issues.push({ code: 'invalid_claim_type', claimId: id, message: `Claim ${id} has an invalid claim type.` });
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    if (!isValidClaimRole(claim.role)) {
      issues.push({
        code: claim.role ? 'invalid_claim_role' : 'missing_claim_role',
        claimId: id,
        message: `Claim ${id} is missing a valid answer role.`,
      });
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    if (!Array.isArray(claim.answers)) {
      issues.push({
        code: 'missing_claim_answers',
        claimId: id,
        message: `Claim ${id} must declare which AnswerGoal items it answers.`,
      });
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    const missing = claim.evidenceIds.filter((evidenceId) => !evidenceById.has(evidenceId));
    for (const evidenceId of missing) {
      issues.push({
        code: 'missing_evidence_reference',
        claimId: id,
        evidenceId,
        message: `Claim ${id} references missing evidence ${evidenceId}.`,
      });
    }
    const validEvidenceIds = Array.from(new Set(claim.evidenceIds.filter((evidenceId) => evidenceById.has(evidenceId))));
    const validEvidence = validEvidenceIds.map((evidenceId) => evidenceById.get(evidenceId)!);
    const factHasAuthority = claim.type !== 'fact' || validEvidence.some((item) => (
      item.kind !== 'unknown' && (item.confidence === 'medium' || item.confidence === 'high')
    ));
    const supported = claim.type === 'unknown' || claim.type === 'assumption'
      ? missing.length === 0
      : validEvidenceIds.length > 0 && missing.length === 0;
    if (!factHasAuthority) {
      issues.push({ code: 'low_confidence_fact', claimId: id, message: `Fact ${id} has no medium/high confidence evidence.` });
    }
    if (!supported || !factHasAuthority) {
      issues.push({ code: 'unsupported_claim', claimId: id, message: `Claim ${id} was rejected by deterministic validation.` });
      rejectedClaimIds.push(id);
      return;
    }
    claims.push({ ...claim, id, evidenceIds: validEvidenceIds, answers: Array.from(new Set(claim.answers)) });
  });

  const resultCanConclude = claims.some((claim) => (
    claim.type === 'fact' || claim.type === 'inference'
  ));
  const primaryAnswerIds = primaryAnswerClaimIds(claims, options.answerGoal);
  const missesPrimary = Boolean(options.answerGoal) && primaryAnswerIds.length === 0;
  if (missesPrimary && (result.status === 'concluded' || result.recommendedNextAction === 'final_answer')) {
    issues.push({
      code: claims.some((claim) => claim.role === 'primary_answer') ? 'primary_answer_misses_goal' : 'missing_primary_answer',
      message: 'Final answers must include an accepted primary_answer claim covering the current AnswerGoal.',
    });
  }
  const downgrade = (result.status === 'concluded' || result.recommendedNextAction === 'final_answer') && (!resultCanConclude || missesPrimary);
  const validated: DiagnosticResult = {
    ...result,
    status: downgrade ? 'partial' : result.status,
    summary: downgrade ? '诊断结果包含未通过证据校验的内容，暂不能形成最终结论。' : result.summary,
    evidence,
    claims,
    missingInfo: downgrade
      ? Array.from(new Set([...result.missingInfo, '可验证的 medium/high confidence 证据']))
      : result.missingInfo,
    recommendedNextAction: downgrade ? 'ask_user' : result.recommendedNextAction,
  };
  return {
    result: validated,
    issues,
    acceptedClaimIds: claims.map((claim) => claim.id!),
    rejectedClaimIds,
    primaryAnswerClaimIds: primaryAnswerIds,
  };
}

const VALID_CLAIM_ROLES = new Set<DiagnosticClaimRole>([
  'primary_answer',
  'supporting_context',
  'evidence_locator',
  'process_note',
  'next_action',
  'unknown',
]);

function isValidClaimRole(value: unknown): value is DiagnosticClaimRole {
  return typeof value === 'string' && VALID_CLAIM_ROLES.has(value as DiagnosticClaimRole);
}

function mergeReferencedAdditionalEvidence(
  result: DiagnosticResult,
  additionalEvidence: Evidence[],
  issues: DiagnosticValidationIssue[],
): Evidence[] {
  const evidence = uniqueEvidence(result.evidence, issues);
  const evidenceById = new Set(evidence.map((item) => item.id));
  const referencedIds = new Set(result.claims.flatMap((claim) => claim.evidenceIds));
  for (const item of additionalEvidence) {
    if (!referencedIds.has(item.id) || evidenceById.has(item.id)) {
      continue;
    }
    evidence.push(item);
    evidenceById.add(item.id);
  }
  return evidence;
}

function uniqueEvidence(evidence: Evidence[], issues: DiagnosticValidationIssue[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.id)) {
      issues.push({
        code: 'duplicate_evidence_id',
        evidenceId: item.id,
        message: `Duplicate evidence id ${item.id} was discarded.`,
      });
      return false;
    }
    seen.add(item.id);
    return true;
  });
}
