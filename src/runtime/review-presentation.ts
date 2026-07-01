import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticResult, DiagnosticRun } from '../domain.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { StoredCase } from '../sessions/file-memory-store.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type { ReviewPresentationResult } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import {
  formatReviewFailureFallback,
  personaName,
  ruleBasedReviewAndFormat,
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
    const validation = validateDiagnosticResult(result, run.request?.answerGoal);
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
        const reply = await this.modelDrivenPresentation(caseSession, validated, validation.acceptedClaimIds, validation.acceptedPrimaryAnswerClaimIds, run);
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
      reply: ruleBasedReviewAndFormat(validated, caseSession.userPersona, run.request?.userGoal, {
        answerGoal: run.request?.answerGoal,
        ragAnswerability: run.request?.context?.knowledge?.answerability,
      }),
      decision: frozenDecision,
    };
  }

  private async modelDrivenPresentation(
    caseSession: StoredCase,
    result: DiagnosticResult,
    acceptedClaimIds: string[],
    acceptedPrimaryAnswerClaimIds: string[],
    run: DiagnosticRun,
  ): Promise<string | undefined> {
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.outputReviewAgentSpec}

${this.presentationAgentSpec}

你只负责基于已经通过确定性审核的 claim/evidence 生成回复，并返回 claim/evidence ID 供 runtime 校验；不得新增 ID 或事实。
当前用户视角：${personaName(caseSession.userPersona)}。

只返回 JSON：
{"answerTarget":"用户真实问题","directAnswer":"第一句要正面回答的内容","reply":"最终用户可见中文回复","claimIds":["claim_1"],"evidenceIds":["ev_1"],"directAnswerClaimIds":["claim_1"]}

约束：
- answerTarget 必须来自 answerGoal.resolvedQuestion，不得使用 diagnosticObjective 替代用户问题。
- directAnswerClaimIds 必须等于 frozenPrimaryAnswerClaimIds；如果为空，说明本轮没有最终主答，只能表达初步判断。
- reply 只能使用 acceptedClaims/acceptedEvidence 中已经审核通过的事实、推断和未知，不得新增事实。
- claimIds 必须非空，且只能选择 acceptedClaims 中存在的 ID。
- evidenceIds 必须覆盖所选 claimIds 引用的全部 evidence。
- 先表达 frozen primary answer，再调整 persona 语气；不得通过中文问法列表、问题类型枚举或过程目标选择主答。
- 不要把“系统 bug / 设计使然 / 配置或使用问题 / 目前不能确认”这类归类放在结论第一句，除非它本身就是 frozen primary answer。
- 非开发视角不得暴露 src/、knowledge/_sources、caseId/runId、worker command、raw stdout/stderr、内部 prompt。
- 确定性 Review Gate 已冻结结论状态，Presentation 无权修改 outcome/status/recommendedNextAction。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          caseId: caseSession.id,
          workspaceId: caseSession.workspaceId,
          frozenDecision: decisionFromDiagnosticResult(result),
          answerGoal: run.request?.answerGoal,
          ragAnswerability: run.request?.context?.knowledge?.answerability,
          frozenPrimaryAnswerClaimIds: acceptedPrimaryAnswerClaimIds,
          acceptedClaims: result.claims.map((claim) => ({ id: claim.id, type: claim.type, role: claim.role, text: claim.text, evidenceIds: claim.evidenceIds, answers: claim.answers })),
          acceptedEvidence: result.evidence.map((evidence) => ({ id: evidence.id, kind: evidence.kind, source: evidence.source, summary: evidence.summary, confidence: evidence.confidence })),
        }),
      },
    ], { json: true });
    const parsed = parseAgentModelJson<ModelPresentationParsed>(response);
    this.events.modelReviewResult(caseSession, response, parsed);
    return validateModelPresentation({
      parsed,
      result,
      acceptedClaimIds,
      acceptedPrimaryAnswerClaimIds,
      persona: caseSession.userPersona,
    })?.reply;
  }
}

interface ModelPresentationParsed {
  answerTarget?: unknown;
  directAnswer?: unknown;
  reply?: unknown;
  claimIds?: unknown;
  evidenceIds?: unknown;
  directAnswerClaimIds?: unknown;
}

function validateModelPresentation(input: {
  parsed: ModelPresentationParsed;
  result: DiagnosticResult;
  acceptedClaimIds: string[];
  acceptedPrimaryAnswerClaimIds: string[];
  persona: StoredCase['userPersona'];
}): { reply: string; claimIds: string[]; evidenceIds: string[] } | undefined {
  const { parsed, result, acceptedClaimIds, acceptedPrimaryAnswerClaimIds, persona } = input;
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return undefined;
  }
  if (typeof parsed.directAnswer !== 'string' || !parsed.directAnswer.trim()) {
    return undefined;
  }
  if (!Array.isArray(parsed.claimIds) || !Array.isArray(parsed.evidenceIds)) {
    return undefined;
  }
  if (acceptedPrimaryAnswerClaimIds.length > 0 && !Array.isArray(parsed.directAnswerClaimIds)) {
    return undefined;
  }
  if (!parsed.claimIds.every((id): id is string => typeof id === 'string')) {
    return undefined;
  }
  if (!parsed.evidenceIds.every((id): id is string => typeof id === 'string')) {
    return undefined;
  }
  if (Array.isArray(parsed.directAnswerClaimIds) && !parsed.directAnswerClaimIds.every((id): id is string => typeof id === 'string')) {
    return undefined;
  }

  const claimIds = Array.from(new Set(parsed.claimIds));
  const evidenceIds = Array.from(new Set(parsed.evidenceIds));
  const directAnswerClaimIds = Array.isArray(parsed.directAnswerClaimIds)
    ? Array.from(new Set(parsed.directAnswerClaimIds))
    : [];
  const acceptedClaimIdSet = new Set(acceptedClaimIds);
  const evidenceById = new Map(result.evidence.map((evidence) => [evidence.id, evidence]));
  if (claimIds.length === 0 || claimIds.some((id) => !acceptedClaimIdSet.has(id))) {
    return undefined;
  }
  if (evidenceIds.length === 0 || evidenceIds.some((id) => !evidenceById.has(id))) {
    return undefined;
  }

  const claimsById = new Map(result.claims.map((claim) => [claim.id, claim]));
  const selectedClaims = claimIds.map((id) => claimsById.get(id)).filter(Boolean);
  if (selectedClaims.length !== claimIds.length) {
    return undefined;
  }
  const selectedEvidenceIds = new Set(evidenceIds);
  const requiredEvidenceIds = new Set(selectedClaims.flatMap((claim) => claim!.evidenceIds));
  if ([...requiredEvidenceIds].some((id) => !selectedEvidenceIds.has(id))) {
    return undefined;
  }

  const reply = parsed.reply.trim();
  const directAnswer = parsed.directAnswer.trim();
  if (persona !== 'developer' && containsInternalDetails(reply)) {
    return undefined;
  }
  if (!replyStartsWithDirectAnswer(reply, directAnswer)) {
    return undefined;
  }
  const selectedClaimIds = new Set(claimIds);
  const selectedPrimaryIds = claimIds.filter((id) => acceptedPrimaryAnswerClaimIds.includes(id));
  if (acceptedPrimaryAnswerClaimIds.length > 0 && selectedPrimaryIds.length !== acceptedPrimaryAnswerClaimIds.length) {
    return undefined;
  }
  if (acceptedPrimaryAnswerClaimIds.length > 0 && !sameStringSet(directAnswerClaimIds, acceptedPrimaryAnswerClaimIds)) {
    return undefined;
  }
  if (directAnswerClaimIds.some((id) => !selectedClaimIds.has(id))) {
    return undefined;
  }
  const unselectedClaimTexts = result.claims
    .filter((claim) => claim.id && !selectedClaimIds.has(claim.id))
    .map((claim) => claim.text.trim())
    .filter((text) => text.length >= 8);
  if (unselectedClaimTexts.some((text) => reply.includes(text))) {
    return undefined;
  }
  if (selectedClaims.length > 0 && replyLacksSelectedClaimSignal(reply, selectedClaims.map((claim) => claim!))) {
    return undefined;
  }

  return { reply, claimIds, evidenceIds };
}

function replyStartsWithDirectAnswer(reply: string, directAnswer: string): boolean {
  const firstParagraph = reply.split(/\n\s*\n/)[0] ?? reply;
  return normalizeVisibleText(firstParagraph).includes(normalizeVisibleText(directAnswer));
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function normalizeVisibleText(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/[，。；：、！？!?\s"'“”‘’（）()【】[\]<>《》]+/g, '')
    .toLowerCase();
}

function containsInternalDetails(text: string): boolean {
  return /\bsrc\/|knowledge\/_sources|caseId|runId|worker command|raw stdout|raw stderr|\bstdout\b|\bstderr\b|internal prompt|system prompt|内部\s*prompt|claude\s+-p/i.test(text);
}

function replyLacksSelectedClaimSignal(reply: string, selectedClaims: DiagnosticClaimWithId[]): boolean {
  return selectedClaims.some((claim) => !claimSignals(claim.text).some((signal) => reply.includes(signal)));
}

type DiagnosticClaimWithId = DiagnosticResult['claims'][number];

function claimSignals(text: string): string[] {
  return Array.from(new Set(
    text
      .replace(/[，。；：:、（）()]/g, ' ')
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 4)
      .slice(0, 8),
  ));
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
