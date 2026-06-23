import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticResult, DiagnosticRun } from '../domain.js';
import type { AgentModelClient } from '../model.js';
import type { StoredCase } from '../storage.js';
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
        const selected = await this.modelDrivenSelection(caseSession, validated, run, validation.acceptedClaimIds);
        if (selected) {
          return {
            reply: ruleBasedReviewAndFormat(selected, caseSession.userPersona, run.request?.userGoal),
            decision: frozenDecision,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.events.modelReviewFailed(caseSession, message);
      }
    }

    return {
      reply: ruleBasedReviewAndFormat(validated, caseSession.userPersona, run.request?.userGoal),
      decision: frozenDecision,
    };
  }

  private async modelDrivenSelection(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
    acceptedClaimIds: string[],
  ): Promise<DiagnosticResult | undefined> {
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.outputReviewAgentSpec}

${this.presentationAgentSpec}

你只负责为 ${personaName(caseSession.userPersona)} 排列已经通过确定性审核的 claim/evidence ID。
只返回 JSON：{"claimIds":["claim_1"],"evidenceIds":["ev_1"]}
不得返回 outcome、reply、事实文本或新 ID。确定性 Review Gate 已冻结结论状态，Presentation 无权修改。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          caseId: caseSession.id,
          workspaceId: caseSession.workspaceId,
          frozenDecision: decisionFromDiagnosticResult(result),
          acceptedClaims: result.claims.map((claim) => ({ id: claim.id, type: claim.type, text: claim.text, evidenceIds: claim.evidenceIds })),
          acceptedEvidence: result.evidence.map((evidence) => ({ id: evidence.id, kind: evidence.kind, source: evidence.source, summary: evidence.summary, confidence: evidence.confidence })),
        }),
      },
    ], { json: true });
    const parsed = parseAgentModelJson<{ claimIds?: string[]; evidenceIds?: string[] }>(response);
    this.events.modelReviewResult(caseSession, response, parsed);
    if (!Array.isArray(parsed.claimIds) || !Array.isArray(parsed.evidenceIds)) return undefined;
    const claimIds = parsed.claimIds.filter((id) => acceptedClaimIds.includes(id));
    const evidenceIds = parsed.evidenceIds.filter((id) => result.evidence.some((evidence) => evidence.id === id));
    if (claimIds.length !== parsed.claimIds.length || evidenceIds.length !== parsed.evidenceIds.length) return undefined;
    if (claimIds.length === 0 && result.claims.length > 0) return undefined;
    const selectedClaims = claimIds.map((id) => result.claims.find((claim) => claim.id === id)!);
    const requiredEvidenceIds = new Set(selectedClaims.flatMap((claim) => claim.evidenceIds));
    if ([...requiredEvidenceIds].some((id) => !evidenceIds.includes(id))) return undefined;
    return {
      ...result,
      claims: selectedClaims,
      evidence: evidenceIds.map((id) => result.evidence.find((evidence) => evidence.id === id)!),
    };
  }
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
