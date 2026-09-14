import type { SuperHelperConfig } from '../config.js';
import type { AnswerGoal, DiagnosticClaim, DiagnosticResult, DiagnosticRun, Evidence } from '../domain.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { StoredCase } from '../sessions/case-repository.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type { ReviewPresentationResult } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import {
  caseStatusFromDiagnosticResult,
  decisionFromDiagnosticResult,
  type ReviewGlobalBlocker,
} from './review-gate.js';
import {
  freezeReviewedDiagnosticResult,
  validateDiagnosticStructure,
} from './result-validator.js';
import {
  AnswerCoverageService,
  materializeCurrentCoverageReviewInput,
  unknownCoverageReview,
} from './answer-coverage.js';
import {
  buildSafeFrozenAnswerProjection,
  collectVisiblePromptCandidates,
  renderSafeFrozenAnswer,
  type SafeFrozenAnswerProjection,
  type SafePresentationPlan,
  type VisiblePromptReview,
  validateSafePresentationPlan,
} from './safe-answer-projection.js';
import { VisiblePromptSafetyService } from './visible-prompt-safety.js';
import type { CoverageEvidenceEnvelope } from './coverage-evidence-provenance.js';
import { formatSafeWorkerFailure } from './safe-failure-presentation.js';
import { workerFailedBeforeUsableResult, workerFailureCategory } from './review-worker-failure.js';
import { throwIfInvestigationCancelled } from './investigation-cancellation.js';

export class ReviewPresentationService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly mainAgentSpec: string,
    private readonly outputReviewAgentSpec: string,
    private readonly presentationAgentSpec: string,
    private readonly answerCoverageAgentSpec?: string,
    private readonly visiblePromptSafetyAgentSpec?: string,
  ) {}

  async reviewAndFormat(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
    context: {
      coverageEvidenceEnvelopes?: CoverageEvidenceEnvelope[];
      upstreamBlockers?: ReviewGlobalBlocker[];
      signal?: AbortSignal;
    } = {},
  ): Promise<ReviewPresentationResult> {
    const signal = context.signal;
    throwIfInvestigationCancelled(signal);
    this.events.evidenceReviewStarted(caseSession, run, result);
    const answerGoal = run.request?.answerGoal;
    const structural = validateDiagnosticStructure(result, answerGoal);
    const coverageReview = this.answerCoverageAgentSpec && answerGoal
      ? await this.reviewCoverage(
          structural.result.claims,
          structural.result.evidence,
          answerGoal,
          run,
          context.coverageEvidenceEnvelopes ?? [],
          signal,
        )
      : undefined;
    const validation = freezeReviewedDiagnosticResult({
      structural,
      answerGoal: answerGoal ?? fallbackAnswerGoal(structural.result),
      coverageReview,
      upstreamBlockers: [
        ...upstreamGlobalBlockers(run),
        ...(context.upstreamBlockers ?? []),
      ],
    });
    let validated = validation.result;
    const promptCandidates = collectVisiblePromptCandidates({
      result: validated,
      acceptedClaimIds: validation.acceptedClaimIds,
    });
    const visiblePromptReview = await this.reviewVisiblePrompts(promptCandidates, signal);
    let projection = buildSafeFrozenAnswerProjection({
      result: validated,
      answerGoal: answerGoal ?? fallbackAnswerGoal(validated),
      frozenPrimaryClaimIds: validation.acceptedPrimaryAnswerClaimIds,
      acceptedClaimIds: validation.acceptedClaimIds,
      reviewedBindingClaimIds: reviewedBindingClaimIds(coverageReview),
      visiblePromptReview,
    });
    validated = applyProjectionOutcome(validated, projection);
    projection = buildSafeFrozenAnswerProjection({
      result: validated,
      answerGoal: answerGoal ?? fallbackAnswerGoal(validated),
      frozenPrimaryClaimIds: validation.acceptedPrimaryAnswerClaimIds,
      acceptedClaimIds: validation.acceptedClaimIds,
      reviewedBindingClaimIds: reviewedBindingClaimIds(coverageReview),
      visiblePromptReview,
    });
    run.result = validated;
    run.status = validated.status;
    const caseStatus = caseStatusFromDiagnosticResult(validated);
    this.events.evidenceValidationResult(caseSession, run.id, validation);
    const frozenDecision = decisionFromDiagnosticResult(validated);
    const hasReviewedAnswer = [...projection.primary, ...projection.supporting]
      .some(segment => segment.type === 'fact' || segment.type === 'inference');

    if (workerFailedBeforeUsableResult(run)) {
      return {
        reply: formatSafeWorkerFailure({
          category: workerFailureCategory(run),
          status: validated.status,
          nextAction: validated.recommendedNextAction,
        }),
        decision: frozenDecision,
        caseStatus,
        hasReviewedAnswer: false,
      };
    }

    if (this.config.agent.modelProvider && !signal?.aborted) {
      try {
        const reply = await this.modelDrivenPresentation(caseSession, projection, signal);
        if (reply) {
          return {
            reply,
            decision: frozenDecision,
            caseStatus,
            hasReviewedAnswer,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!signal?.aborted) this.events.modelReviewFailed(caseSession, message);
      }
    }

    return {
      reply: renderSafeFrozenAnswer({ projection, persona: caseSession.userPersona }),
      decision: frozenDecision,
      caseStatus,
      hasReviewedAnswer,
    };
  }

  private async reviewVisiblePrompts(
    candidates: ReturnType<typeof collectVisiblePromptCandidates>,
    signal?: AbortSignal,
  ): Promise<VisiblePromptReview> {
    if (!this.visiblePromptSafetyAgentSpec || signal?.aborted) {
      return { status: 'unknown', acceptedIds: [] };
    }
    try { return await new VisiblePromptSafetyService(
      this.model,
      this.visiblePromptSafetyAgentSpec,
    ).review(candidates, signal);
    } catch (error) {
      if (!signal?.aborted) throw error;
      return { status: 'unknown', acceptedIds: [] };
    }
  }

  private async reviewCoverage(
    claims: DiagnosticClaim[],
    evidence: Evidence[],
    answerGoal: AnswerGoal,
    run: DiagnosticRun,
    envelopes: CoverageEvidenceEnvelope[],
    signal?: AbortSignal,
  ) {
    try {
      const reviewInput = materializeCurrentCoverageReviewInput({
        answerGoal,
        claims,
        evidence,
        envelopes,
        currentRunId: run.id,
      });
      return await new AnswerCoverageService(this.model, this.answerCoverageAgentSpec ?? '').review(reviewInput, signal);
    } catch (error) {
      throwIfInvestigationCancelled(signal);
      const reason = error instanceof Error ? error.message : String(error);
      return unknownCoverageReview(`answer coverage unavailable: ${reason}`);
    }
  }

  private async modelDrivenPresentation(
    caseSession: StoredCase,
    projection: SafeFrozenAnswerProjection,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    throwIfInvestigationCancelled(signal);
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.outputReviewAgentSpec}

${this.presentationAgentSpec}

你只负责选择已通过确定性审核的 claim/evidence ID 并规划展示顺序，runtime 会确定性渲染用户可见回复。你不得返回自由回复文本（reply 字段）或新增事实。
当前用户视角：${caseSession.userPersona}。

只返回 JSON：
{"claimIds":["claim_1"],"evidenceIds":["ev_1"],"directAnswerClaimIds":["claim_1"],"actionClaimIds":["action_1"]}

约束：
- 只能排序 projection 中的 safe IDs，不得返回 answerTarget、自由文本或新事实。
- directAnswerClaimIds 必须等于 projection.primary IDs。
- actionClaimIds 必须等于 projection.actions IDs。
- claimIds 必须包含全部 required claim IDs；evidenceIds 必须包含全部 required evidence IDs。
- 不得通过中文问法列表、问题类型枚举或过程目标选择主答。
- 不要把“系统 bug / 设计使然 / 配置或使用问题 / 目前不能确认”这类归类放在结论第一句，除非它本身就是 frozen primary answer。
- 非开发视角不得暴露 src/、knowledge/_sources、caseId/runId、worker command、raw stdout/stderr、内部 prompt、Evidence Judge 分数或路由分数。
- 确定性 Review Gate 已冻结结论状态，Presentation 无权修改 outcome/status/recommendedNextAction。`,
      },
      {
        role: 'user',
        content: JSON.stringify({ projection }),
      },
    ], { json: true, ...(signal ? { signal } : {}) });
    throwIfInvestigationCancelled(signal);
    const parsed = parseAgentModelJson<SafePresentationPlan>(response);
    const planValidation = validateSafePresentationPlan(parsed, projection);
    this.events.modelReviewResult(caseSession, {
      accepted: planValidation.accepted,
      claimIds: safeStringArray(parsed.claimIds),
      evidenceIds: safeStringArray(parsed.evidenceIds),
      directAnswerClaimIds: safeStringArray(parsed.directAnswerClaimIds),
    });
    return renderSafeFrozenAnswer({
      projection,
      persona: caseSession.userPersona,
      plan: parsed,
    });
  }
}

function reviewedBindingClaimIds(review: Awaited<ReturnType<ReviewPresentationService['reviewCoverage']>> | undefined): string[] {
  if (review?.status !== 'accepted') return [];
  return Array.from(new Set(review.bindings.map((binding) => binding.claimId)));
}

function upstreamGlobalBlockers(run: DiagnosticRun): ReviewGlobalBlocker[] {
  const judge = run.request?.context?.knowledge?.judge as {
    blockers?: string[];
    conflicts?: string[];
  } | undefined;
  const blockers = [...(judge?.blockers ?? [])];
  if ((judge?.conflicts?.length ?? 0) > 0 && !blockers.includes('conflicting_knowledge')) {
    blockers.push('conflicting_knowledge');
  }
  return blockers.flatMap((code): ReviewGlobalBlocker[] => {
    if (code === 'conflicting_knowledge') return [{ code: 'evidence_conflict' }];
    if (code === 'high_risk_uncertainty') return [{ code: 'identity_or_safety_blocker' }];
    return [];
  });
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string'))).slice(0, 20);
}

function applyProjectionOutcome(
  result: DiagnosticResult,
  projection: SafeFrozenAnswerProjection,
): DiagnosticResult {
  if (projection.outcome === 'final') return result;
  if (projection.outcome === 'ask_user') {
    return { ...result, status: 'need_input', recommendedNextAction: 'ask_user' };
  }
  if (projection.outcome === 'escalate') {
    return { ...result, status: 'partial', recommendedNextAction: 'escalate_to_human' };
  }
  return { ...result, status: 'partial', recommendedNextAction: 'continue_diagnosis' };
}

function fallbackAnswerGoal(result: DiagnosticResult): AnswerGoal {
  return {
    rawUserQuestion: '',
    resolvedQuestion: '当前问题',
    answerObject: '当前问题',
    mustAnswerItems: ['direct_answer'],
    diagnosticObjective: '',
    sourceMessageIds: [],
  };
}
