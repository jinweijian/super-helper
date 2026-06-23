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
import { decisionFromDiagnosticResult, decisionFromReviewOutcome } from './review-gate.js';

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

    if (this.config.agent.modelProvider) {
      try {
        const modelReview = await this.modelDrivenReview(caseSession, result, run);
        if (modelReview) {
          return modelReview;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.events.modelReviewFailed(caseSession, message);
        return {
          reply: formatReviewFailureFallback(result, caseSession.userPersona, run.request?.userGoal, run.workerTrace, message),
          decision: decisionFromDiagnosticResult(result),
        };
      }
    }

    return {
      reply: ruleBasedReviewAndFormat(result, caseSession.userPersona, run.request?.userGoal),
      decision: decisionFromDiagnosticResult(result),
    };
  }

  private async modelDrivenReview(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
  ): Promise<ReviewPresentationResult | undefined> {
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.outputReviewAgentSpec}

${this.presentationAgentSpec}

You are reviewing a Claude Code diagnostic result before the user sees it.
The user-facing persona is: ${caseSession.userPersona} (${personaName(caseSession.userPersona)}).
Return JSON only:
{"outcome":"ask_user|partial|final_answer|escalate_to_human","reply":"Chinese user-facing reply"}

Rules:
- Do not invent facts.
- Reject unsupported facts.
- Keep the main reply concise.
- Mention evidence and unknowns.
- If persona is operations/customer, avoid deep code details in the main reply; translate evidence into product behavior, configuration location, impact, and next action.
- If persona is developer, include code paths only when they are useful evidence.
- If the worker failed or timed out, say the diagnosis is incomplete.
- For final_answer, the reply must include these Chinese sections: 目前判断, 最终解释, 支撑证据.
- In 最终解释, summarize the key supported claims from diagnosticResult.claims instead of only restating the summary.
- Do not include <think>, markdown, comments, explanations, or text outside the JSON object.`,
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            caseId: caseSession.id,
            workspaceId: caseSession.workspaceId,
            latestMessages: caseSession.messages.slice(-8),
            diagnosticRequest: run.request,
            diagnosticResult: result,
            workerTrace: run.workerTrace
              ? {
                  command: run.workerTrace.command,
                  cwd: run.workerTrace.cwd,
                  exitCode: run.workerTrace.exitCode,
                  signal: run.workerTrace.signal,
                  error: run.workerTrace.error,
                }
              : undefined,
          },
          null,
          2,
        ),
      },
    ], { json: true });

    const parsed = parseAgentModelJson<{
      outcome?: 'ask_user' | 'partial' | 'final_answer' | 'escalate_to_human';
      reply?: string;
    }>(response);

    this.events.modelReviewResult(caseSession, response, parsed);

    if (!parsed.reply) {
      return undefined;
    }

    return {
      reply: parsed.reply,
      decision: decisionFromReviewOutcome(parsed.outcome, result),
    };
  }
}
