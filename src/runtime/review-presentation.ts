import type { SuperHelperConfig } from '../config.js';
import type { AnswerContract, DiagnosticResult, DiagnosticRun } from '../domain.js';
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
        const reply = await this.modelDrivenPresentation(caseSession, validated, validation.acceptedClaimIds, run);
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
        answerContract: run.request?.context?.answerContract,
        ragAnswerability: run.request?.context?.knowledge?.answerability,
      }),
      decision: frozenDecision,
    };
  }

  private async modelDrivenPresentation(
    caseSession: StoredCase,
    result: DiagnosticResult,
    acceptedClaimIds: string[],
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
{"reply":"最终用户可见中文回复","claimIds":["claim_1"],"evidenceIds":["ev_1"]}

约束：
- reply 只能使用 acceptedClaims/acceptedEvidence 中已经审核通过的事实、推断和未知，不得新增事实。
- claimIds 必须非空，且只能选择 acceptedClaims 中存在的 ID。
- evidenceIds 必须覆盖所选 claimIds 引用的全部 evidence。
- 先判断用户问题类型，再调整 persona 语气；说明、功能、入口、规则类问题先直接回答用户问题。
- 只有用户问故障、异常、失败、报错、排障时，运营视角才需要输出“系统 bug / 设计使然 / 配置或使用问题 / 目前不能确认”的归类。
- 非开发视角不得暴露 src/、knowledge/_sources、caseId/runId、worker command、raw stdout/stderr、内部 prompt。
- 确定性 Review Gate 已冻结结论状态，Presentation 无权修改 outcome/status/recommendedNextAction。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          caseId: caseSession.id,
          workspaceId: caseSession.workspaceId,
          frozenDecision: decisionFromDiagnosticResult(result),
          answerContract: run.request?.context?.answerContract,
          ragAnswerability: run.request?.context?.knowledge?.answerability,
          acceptedClaims: result.claims.map((claim) => ({ id: claim.id, type: claim.type, text: claim.text, evidenceIds: claim.evidenceIds })),
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
      persona: caseSession.userPersona,
      answerContract: run.request?.context?.answerContract,
    })?.reply;
  }
}

interface ModelPresentationParsed {
  reply?: unknown;
  claimIds?: unknown;
  evidenceIds?: unknown;
}

function validateModelPresentation(input: {
  parsed: ModelPresentationParsed;
  result: DiagnosticResult;
  acceptedClaimIds: string[];
  persona: StoredCase['userPersona'];
  answerContract?: AnswerContract;
}): { reply: string; claimIds: string[]; evidenceIds: string[] } | undefined {
  const { parsed, result, acceptedClaimIds, persona, answerContract } = input;
  if (typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    return undefined;
  }
  if (!Array.isArray(parsed.claimIds) || !Array.isArray(parsed.evidenceIds)) {
    return undefined;
  }
  if (!parsed.claimIds.every((id): id is string => typeof id === 'string')) {
    return undefined;
  }
  if (!parsed.evidenceIds.every((id): id is string => typeof id === 'string')) {
    return undefined;
  }

  const claimIds = Array.from(new Set(parsed.claimIds));
  const evidenceIds = Array.from(new Set(parsed.evidenceIds));
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
  if (persona !== 'developer' && containsInternalDetails(reply)) {
    return undefined;
  }
  const selectedClaimIds = new Set(claimIds);
  const unselectedClaimTexts = result.claims
    .filter((claim) => claim.id && !selectedClaimIds.has(claim.id))
    .map((claim) => claim.text.trim())
    .filter((text) => text.length >= 8);
  if (unselectedClaimTexts.some((text) => reply.includes(text))) {
    return undefined;
  }
  if (answerContract && selectedClaims.length > 0 && replyLacksSelectedClaimSignal(reply, selectedClaims.map((claim) => claim!))) {
    return undefined;
  }

  return { reply, claimIds, evidenceIds };
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
