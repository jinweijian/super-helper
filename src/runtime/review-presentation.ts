import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticClaim, DiagnosticResult, DiagnosticRun, Evidence } from '../domain.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { StoredCase } from '../sessions/file-memory-store.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type { ReviewPresentationResult } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import {
  formatSafeFallbackReply,
  formatReviewFailureFallback,
  isDirectoryQuestion,
  isSupportQuestion,
  personaName,
  selectDirectAnswerClaim,
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
    const validation = validateDiagnosticResult(result);
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
          run.request?.userGoal,
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
      reply: formatSafeFallbackReply(validated, run.request?.userGoal, caseSession.userPersona),
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
用户问题会在 userGoal 字段中提供；必须问什么答什么，reply 第一段必须覆盖 directAnswer，不能先讲背景、原因或泛化建议。
视角只改变表达方式，不删除关键信息：客户问技术问题时，也要保留目录、配置项、接口、限制条件等直接回答所需信息。
只返回 JSON，形状必须是：
{"answerTarget":"用户实际询问的对象","directAnswer":"对该对象的直接回答","reply":"最终中文回复","claimIds":["claim_1"],"evidenceIds":["ev_1"],"directAnswerClaimIds":["claim_1"]}
不得返回 outcome，不得新增未审核事实，不得引用不存在、已拒绝或未选择的 claim/evidence ID。确定性 Review Gate 已冻结结论状态，Presentation 无权修改。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          caseId: caseSession.id,
          workspaceId: caseSession.workspaceId,
          userGoal: run.request?.userGoal,
          userPersona: caseSession.userPersona,
          frozenDecision: decisionFromDiagnosticResult(result),
          missingInfo: result.missingInfo,
          acceptedClaims: result.claims.map((claim) => ({ id: claim.id, type: claim.type, text: claim.text, evidenceIds: claim.evidenceIds })),
          acceptedEvidence: result.evidence.map((evidence) => ({ id: evidence.id, kind: evidence.kind, source: evidence.source, summary: evidence.summary, confidence: evidence.confidence })),
        }),
      },
    ], { json: true });
    const parsed = parseAgentModelJson<PresentationModelOutput>(response);
    this.events.modelReviewResult(caseSession, response, parsed);
    const validated = validatePresentationOutput(parsed, result, acceptedClaimIds, run.request?.userGoal);
    if (!validated.ok) throw new Error(validated.reason);
    return parsed.reply!.trim();
  }
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
  userGoal?: string,
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

  const selectedClaims = output.claimIds.map((id) => claimById(result.claims, id)!);
  const directClaims = output.directAnswerClaimIds.map((id) => claimById(result.claims, id)!);
  const selectedEvidence = output.evidenceIds.map((id) => evidenceById(result.evidence, id)!);
  const selectedEvidenceIds = new Set(output.evidenceIds);
  const requiredEvidenceIds = new Set(selectedClaims.flatMap((claim) => claim.evidenceIds));
  if ([...requiredEvidenceIds].some((id) => !selectedEvidenceIds.has(id))) return invalid('Presentation omitted evidence required by selected claims.');
  if (selectedClaims.some((claim) => claim.type === 'assumption' || claim.type === 'unknown')) return invalid('Presentation selected non-answer claims.');
  if (directClaims.some((claim) => claim.type === 'assumption' || claim.type === 'unknown')) return invalid('Presentation direct answer used non-answer claims.');
  if (dropsExpectedDirectAnswer(result.claims, directClaims, userGoal)) return invalid('Presentation omitted the best direct answer claim.');
  if (containsUnreviewedPathFacts(output, selectedClaims, selectedEvidence)) return invalid('Presentation introduced unreviewed path facts.');

  const firstParagraph = firstReplyParagraph(output.reply);
  if (!coversDirectAnswer(firstParagraph, output.directAnswer)) return invalid('Presentation first paragraph does not cover directAnswer.');
  if (isGenericNonAnswer(output.directAnswer)) return invalid('Presentation directAnswer is generic.');

  const directText = `${output.directAnswer}\n${firstParagraph}`;
  if (isSupportQuestion(userGoal) && !/(支持|不支持|可以|不能|无法|目前不能确认)/.test(directText)) {
    return invalid('Presentation did not answer support polarity.');
  }

  if (isDirectoryQuestion(userGoal)) {
    const requiredPaths = directClaims.flatMap((claim) => extractPathTokens(claim.text));
    if (requiredPaths.length > 0 && !requiredPaths.some((path) => directText.includes(path))) {
      return invalid('Presentation omitted required path details.');
    }
    if (/相关系统位置/.test(directText)) return invalid('Presentation redacted path details required by the question.');
  }

  return { ok: true };
}

function dropsExpectedDirectAnswer(
  acceptedClaims: DiagnosticResult['claims'],
  directClaims: DiagnosticResult['claims'],
  userGoal?: string,
): boolean {
  if (!isSupportQuestion(userGoal) && !isDirectoryQuestion(userGoal)) return false;
  const acceptedPrimary = selectDirectAnswerClaim(acceptedClaims, userGoal);
  if (!acceptedPrimary) return false;
  return !directClaims.some((claim) => claim.id === acceptedPrimary.id);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

function isGenericNonAnswer(text: string): boolean {
  return /先按|上面|人工支持|查看证据|补充页面|操作步骤|不能判断原因/.test(text);
}

function containsUnreviewedPathFacts(
  output: PresentationModelOutput,
  selectedClaims: DiagnosticClaim[],
  selectedEvidence: Evidence[],
): boolean {
  const replyTokens = extractPathTokens(`${output.directAnswer ?? ''}\n${output.reply ?? ''}`);
  if (replyTokens.length === 0) return false;
  const allowedText = [
    ...selectedClaims.map((claim) => claim.text),
    ...selectedEvidence.flatMap((evidence) => [evidence.source, evidence.summary]),
  ].join('\n');
  const allowedTokens = extractPathTokens(allowedText);
  return replyTokens.some((token) => !pathTokenAllowed(token, allowedTokens));
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
