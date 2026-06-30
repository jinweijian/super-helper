import type { SuperHelperConfig } from '../config.js';
import type { AnswerGoal, DiagnosticClaim, DiagnosticResult, DiagnosticRun, Evidence } from '../domain.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { StoredCase } from '../sessions/file-memory-store.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type { ReviewPresentationResult } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import {
  formatSafeFallbackReply,
  formatReviewFailureFallback,
  personaName,
} from './presenter.js';
import {
  caseStatusFromDiagnosticResult,
  decisionFromDiagnosticResult,
} from './review-gate.js';
import { validateDiagnosticResult } from './result-validator.js';

export class ReviewPresentationService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly mainAgentSpec: string,
    private readonly outputReviewAgentSpec: string,
    private readonly presentationAgentSpec: string,
  ) {}

  async reviewAndFormat(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
  ): Promise<ReviewPresentationResult> {
    this.events.evidenceReviewStarted(caseSession, run, result);
    const validation = validateDiagnosticResult(result, {
      additionalEvidence: additionalEvidenceFromRunContext(run),
      answerGoal: run.request?.answerGoal,
    });
    const validated = validation.result;
    run.result = validated;
    run.status = validated.status;
    caseSession.status = caseStatusFromDiagnosticResult(validated);
    this.events.evidenceValidationResult(caseSession, run.id, validation);
    const frozenDecision = decisionFromDiagnosticResult(validated);

    if (workerFailedBeforeUsableResult(run)) {
      return {
        reply: formatReviewFailureFallback(
          validated,
          caseSession.userPersona,
          run.request?.answerGoal,
          run.workerTrace,
          '',
          { caseId: caseSession.id, runId: run.id },
        ),
        decision: frozenDecision,
      };
    }

    if (this.config.agent.modelProvider) {
      try {
        const reply = await this.modelDrivenPresentation(caseSession, validated, run, validation.acceptedClaimIds);
        if (reply) {
          return {
            reply,
            decision: frozenDecision,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.events.modelReviewFailed(caseSession, message);
      }
    }

    return {
      reply: formatSafeFallbackReply(
        validated,
        run.request?.answerGoal,
        caseSession.userPersona,
        validation.primaryAnswerClaimIds,
      ),
      decision: frozenDecision,
    };
  }

  private async modelDrivenPresentation(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
    acceptedClaimIds: string[],
  ): Promise<string | undefined> {
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.outputReviewAgentSpec}

${this.presentationAgentSpec}

你只负责把已经通过确定性审核的事实边界整理成 ${personaName(caseSession.userPersona)} 能读懂的最终中文回复。
用户问题会在 answerGoal 字段中提供；必须表达 frozenPrimaryAnswerClaimIds 指定的主答，reply 第一段必须覆盖 directAnswer，不能先讲背景、原因或泛化建议。
diagnosticObjective 只用于理解内部排查目标，不能作为用户结论或 directAnswer。
视角只改变表达方式，不删除关键信息：客户问技术问题时，也要保留目录、配置项、接口、限制条件等直接回答所需信息。
只返回 JSON，形状必须是：
{"answerTarget":"用户实际询问的对象","directAnswer":"对该对象的直接回答","reply":"最终中文回复","claimIds":["claim_1"],"evidenceIds":["ev_1"],"directAnswerClaimIds":["claim_1"]}
directAnswerClaimIds 必须等于 frozenPrimaryAnswerClaimIds，不得自行选择其他 claim。
不得返回 outcome，不得新增未审核事实，不得引用不存在、已拒绝或未选择的 claim/evidence ID。确定性 Review Gate 已冻结结论状态和主答，Presentation 无权修改。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          caseId: caseSession.id,
          workspaceId: caseSession.workspaceId,
          answerGoal: run.request?.answerGoal,
          userPersona: caseSession.userPersona,
          frozenDecision: decisionFromDiagnosticResult(result),
          frozenPrimaryAnswerClaimIds: validateDiagnosticResult(result, {
            answerGoal: run.request?.answerGoal,
            additionalEvidence: additionalEvidenceFromRunContext(run),
          }).primaryAnswerClaimIds,
          missingInfo: result.missingInfo,
          acceptedClaims: result.claims.map((claim) => ({
            id: claim.id,
            type: claim.type,
            role: claim.role,
            text: claim.text,
            evidenceIds: claim.evidenceIds,
            answers: claim.answers,
          })),
          acceptedEvidence: result.evidence.map((evidence) => ({ id: evidence.id, kind: evidence.kind, source: evidence.source, summary: evidence.summary, confidence: evidence.confidence })),
        }),
      },
    ], { json: true });
    const parsed = parseAgentModelJson<PresentationModelOutput>(response);
    this.events.modelReviewResult(caseSession, response, parsed);
    const reviewValidation = validateDiagnosticResult(result, {
      answerGoal: run.request?.answerGoal,
      additionalEvidence: additionalEvidenceFromRunContext(run),
    });
    const validated = validatePresentationOutput(
      parsed,
      result,
      acceptedClaimIds,
      reviewValidation.primaryAnswerClaimIds,
      run.request?.answerGoal,
    );
    if (!validated.ok) throw new Error(validated.reason);
    return parsed.reply!.trim();
  }
}

function additionalEvidenceFromRunContext(run: DiagnosticRun): Evidence[] {
  return run.request?.context?.previousRuns.flatMap((previousRun) => previousRun.evidence) ?? [];
}

interface PresentationModelOutput {
  answerTarget?: string;
  directAnswer?: string;
  reply?: string;
  claimIds?: string[];
  evidenceIds?: string[];
  directAnswerClaimIds?: string[];
}

function validatePresentationOutput(
  output: PresentationModelOutput,
  result: DiagnosticResult,
  acceptedClaimIds: string[],
  frozenPrimaryAnswerClaimIds: string[],
  answerGoal?: AnswerGoal,
): { ok: true } | { ok: false; reason: string } {
  if (!nonEmptyString(output.answerTarget)) return invalid('Presentation answerTarget is empty.');
  if (!nonEmptyString(output.directAnswer)) return invalid('Presentation directAnswer is empty.');
  if (!nonEmptyString(output.reply)) return invalid('Presentation reply is empty.');
  if (!Array.isArray(output.claimIds)) return invalid('Presentation claimIds must be an array.');
  if (!Array.isArray(output.evidenceIds)) return invalid('Presentation evidenceIds must be an array.');
  if (!Array.isArray(output.directAnswerClaimIds)) return invalid('Presentation directAnswerClaimIds must be an array.');

  const acceptedClaimIdSet = new Set(acceptedClaimIds);
  const evidenceIdSet = new Set(result.evidence.map((evidence) => evidence.id));
  if (output.claimIds.some((id) => !acceptedClaimIdSet.has(id))) return invalid('Presentation referenced unaccepted claim IDs.');
  if (output.evidenceIds.some((id) => !evidenceIdSet.has(id))) return invalid('Presentation referenced unknown evidence IDs.');
  if (output.directAnswerClaimIds.some((id) => !acceptedClaimIdSet.has(id))) return invalid('Presentation referenced unaccepted direct answer claim IDs.');
  if (output.directAnswerClaimIds.some((id) => !output.claimIds!.includes(id))) return invalid('Presentation directAnswerClaimIds must be included in claimIds.');
  if (output.claimIds.length === 0 && result.claims.length > 0) return invalid('Presentation selected no claims.');
  if (output.directAnswerClaimIds.length === 0) return invalid('Presentation selected no direct answer claim IDs.');
  if (!sameStringSet(output.directAnswerClaimIds, frozenPrimaryAnswerClaimIds)) {
    return invalid('Presentation direct answer claim IDs must match frozen primary answer claim IDs.');
  }

  const selectedClaims = output.claimIds.map((id) => claimById(result.claims, id)!);
  const directClaims = output.directAnswerClaimIds.map((id) => claimById(result.claims, id)!);
  const selectedEvidenceIds = new Set(output.evidenceIds);
  const requiredEvidenceIds = new Set(selectedClaims.flatMap((claim) => claim.evidenceIds));
  if ([...requiredEvidenceIds].some((id) => !selectedEvidenceIds.has(id))) return invalid('Presentation omitted evidence required by selected claims.');
  if (output.evidenceIds.some((id) => !requiredEvidenceIds.has(id))) return invalid('Presentation referenced evidence IDs not bound to selected claims.');
  const selectedEvidence = output.evidenceIds.map((id) => evidenceById(result.evidence, id)!);
  const allowedPresentationText = buildAllowedPresentationText(result, selectedClaims, selectedEvidence);
  if (selectedClaims.some((claim) => claim.type === 'assumption' || claim.type === 'unknown')) return invalid('Presentation selected non-answer claims.');
  if (directClaims.some((claim) => claim.type === 'assumption' || claim.type === 'unknown')) return invalid('Presentation direct answer used non-answer claims.');
  if (directClaims.some((claim) => claim.role !== 'primary_answer')) return invalid('Presentation direct answer used non-primary claims.');
  if (answerGoal && directClaims.some((claim) => !answerGoal.mustAnswerItems.every((item) => claim.answers.includes(item)))) {
    return invalid('Presentation direct answer does not cover AnswerGoal.');
  }
  if (containsUnreviewedPathFacts(output, allowedPresentationText)) return invalid('Presentation introduced unreviewed path facts.');
  if (containsUnsupportedAnswerFacts(output, allowedPresentationText)) return invalid('Presentation introduced unsupported answer facts.');

  const firstParagraph = firstReplyParagraph(output.reply);
  if (!coversDirectAnswer(firstParagraph, output.directAnswer)) return invalid('Presentation first paragraph does not cover directAnswer.');

  return { ok: true };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false;
  if (leftSet.size !== rightSet.size) return false;
  return [...leftSet].every((item) => rightSet.has(item));
}

function invalid(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function claimById(claims: DiagnosticClaim[], id: string): DiagnosticClaim | undefined {
  return claims.find((claim) => claim.id === id);
}

function evidenceById(evidenceItems: Evidence[], id: string): Evidence | undefined {
  return evidenceItems.find((item) => item.id === id);
}

function firstReplyParagraph(reply: string): string {
  return reply.trim().split(/\n\s*\n/)[0] ?? '';
}

function coversDirectAnswer(firstParagraph: string, directAnswer: string): boolean {
  const normalizedFirst = normalizeAnswerText(firstParagraph);
  const normalizedDirect = normalizeAnswerText(directAnswer);
  if (normalizedFirst.includes(normalizedDirect)) return true;
  const tokens = answerTokens(normalizedDirect);
  if (tokens.length === 0) return false;
  const matched = tokens.filter((token) => normalizedFirst.includes(token)).length;
  return matched >= Math.min(tokens.length, 3) && matched / tokens.length >= 0.6;
}

function normalizeAnswerText(text: string): string {
  return text
    .replace(/[`*_#>]/g, '')
    .replace(/[，。；：、！？!?\s]/g, '')
    .trim();
}

function answerTokens(text: string): string[] {
  return Array.from(new Set(text.match(/[A-Za-z0-9_.{}%-]+(?:\/[A-Za-z0-9_.{}%-]+)*|[\u4e00-\u9fa5]{2,}/g) ?? []))
    .filter((token) => token.length >= 2 && !/^(结论|可以|支持|不能|无法|目前|当前)$/.test(token));
}

function buildAllowedPresentationText(
  result: DiagnosticResult,
  selectedClaims: DiagnosticClaim[],
  selectedEvidence: Evidence[],
): string {
  return [
    ...selectedClaims.map((claim) => claim.text),
    ...selectedEvidence.flatMap((evidence) => [evidence.source, evidence.summary]),
    ...result.missingInfo,
  ].join('\n');
}

function containsUnreviewedPathFacts(output: PresentationModelOutput, allowedText: string): boolean {
  const replyTokens = extractPathTokens(`${output.directAnswer ?? ''}\n${output.reply ?? ''}`);
  if (replyTokens.length === 0) return false;
  const allowedTokens = extractPathTokens(allowedText);
  return replyTokens.some((token) => !pathTokenAllowed(token, allowedTokens));
}

function containsUnsupportedAnswerFacts(output: PresentationModelOutput, allowedText: string): boolean {
  const answerText = [
    output.directAnswer ?? '',
    output.reply ?? '',
  ].join('\n');

  return answerFactClauses(answerText).some((clause) => !factClauseSupported(clause, allowedText));
}

function answerFactClauses(text: string): string[] {
  return text
    .replace(/[`*_#>]/g, '')
    .split(/(?:\r?\n)+|[。；！？!?]|[，,]\s*(?:并且|而且|另外|此外|还|但|但是|需要|必须)|(?:并且|而且|另外|此外)/g)
    .map((clause) => normalizeFactClause(clause))
    .filter((clause) => clause.length >= 4 && !/^(结论|原因|说明|证据)$/.test(clause));
}

function normalizeFactClause(text: string): string {
  return text
    .replace(/^结论[:：]?/, '')
    .replace(/^(原因是|证据显示|显示|说明[:：]?|因此|所以|同时|还|当前|目前)/, '')
    .replace(/[，,：:、（）()「」“”"'‘’\s]/g, '')
    .trim();
}

function factClauseSupported(clause: string, allowedText: string): boolean {
  const normalizedAllowed = normalizeFactClause(allowedText);
  const normalizedClause = normalizeFactClause(clause);
  if (!normalizedClause) return true;
  if (normalizedAllowed.includes(normalizedClause)) return true;

  const asciiTokens = normalizedClause.match(/[A-Za-z0-9_.{}%-]+(?:\/[A-Za-z0-9_.{}%-]+)*/g) ?? [];
  if (asciiTokens.length > 0 && asciiTokens.every((token) => normalizedAllowed.includes(token))) {
    const withoutAscii = normalizeFactClause(normalizedClause.replace(/[A-Za-z0-9_.{}%-]+(?:\/[A-Za-z0-9_.{}%-]+)*/g, ''));
    const allowedWithoutAscii = normalizeFactClause(normalizedAllowed.replace(/[A-Za-z0-9_.{}%-]+(?:\/[A-Za-z0-9_.{}%-]+)*/g, ''));
    return withoutAscii.length === 0 || hasChineseSupportAnchor(withoutAscii, allowedWithoutAscii);
  }

  return hasChineseSupportAnchor(normalizedClause, normalizedAllowed);
}

function hasChineseSupportAnchor(clause: string, allowedText: string): boolean {
  const chineseRuns = clause.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  if (chineseRuns.length === 0) return true;
  return chineseRuns.some((run) => longestCommonSubstringLength(run, allowedText) >= supportAnchorLength(run));
}

function supportAnchorLength(text: string): number {
  if (text.length <= 3) return text.length;
  if (text.length <= 6) return 3;
  return 4;
}

function longestCommonSubstringLength(left: string, right: string): number {
  let longest = 0;
  for (let start = 0; start < left.length; start += 1) {
    for (let end = start + 1; end <= left.length; end += 1) {
      const length = end - start;
      if (length <= longest) continue;
      if (right.includes(left.slice(start, end))) {
        longest = length;
      }
    }
  }
  return longest;
}

function pathTokenAllowed(token: string, allowedTokens: string[]): boolean {
  const normalized = normalizePathToken(token);
  return allowedTokens.some((allowed) => {
    const normalizedAllowed = normalizePathToken(allowed);
    return normalized === normalizedAllowed
      || normalized.includes(normalizedAllowed)
      || normalizedAllowed.includes(normalized);
  });
}

function normalizePathToken(token: string): string {
  return token
    .replace(/[`"'“”‘’]/g, '')
    .replace(/[，。；：、！？!?\s]+$/g, '')
    .replace(/^edusoho\//i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function extractPathTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9_.{}%-]+(?:\/[A-Za-z0-9_.{}%-]+)+\/?/g) ?? [];
}

function workerFailedBeforeUsableResult(run: DiagnosticRun): boolean {
  const trace = run.workerTrace;
  const failed = Boolean(trace && (
    trace.error || trace.signal || (trace.exitCode !== undefined && trace.exitCode !== 0)
  ));
  if (!failed) return false;

  // Worker failure parsers may attach a high-confidence log item describing the
  // failure itself. That item is useful for diagnostics, but is not usable
  // domain evidence and must never make the raw failure eligible for presentation.
  return !run.result?.evidence.some((evidence) => (
    evidence.kind !== 'log' && evidence.confidence !== 'low'
  ));
}
