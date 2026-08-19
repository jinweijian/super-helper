import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticRun, UserPersona } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { DiagnosticWorker } from '../workers/diagnostic-worker.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { RuntimeTurnResponse, AcceptedUserTurn } from './contracts.js';
import { formatPreflightQuestion } from './preflight-presentation.js';
import { CaseTurnQueue } from './turn-queue.js';
import { bindTurnContextCutoff, clearTurnContextCutoff } from '../sessions/turn-context-snapshot.js';
import type { McpEvidenceServiceOptions } from '../mcp/evidence-service.js';
import { findRetryableInterruption, markInheritedActiveTurnsRetryable, removeInterruptionPlaceholder } from '../sessions/stale-turn.js';
import { completePresentedTurn } from './turn-completion.js';
import { createRuntimeServices } from './runtime-composition.js';

export interface AgentResponse extends RuntimeTurnResponse {}
export interface DiagnosticRuntimeOptions {
  mcp?: McpEvidenceServiceOptions;
  model?: AgentModelClient;
}

export class DiagnosticRuntime {
  private readonly services: ReturnType<typeof createRuntimeServices>;
  private readonly turnQueue = new CaseTurnQueue();

  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: CaseRepository,
    worker: DiagnosticWorker,
    options: DiagnosticRuntimeOptions = {},
  ) {
    this.services = createRuntimeServices({ config, store, worker, options });
  }

  async handleUserMessage(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): Promise<AgentResponse> {
    const turn = this.startUserTurn(input);
    return this.completeUserTurn(turn.caseSession.id, turn.userMessageId);
  }

  loadCase(caseId: string): StoredCase | undefined {
    return this.services.sessions.loadCase(caseId);
  }

  startUserTurn(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): AcceptedUserTurn {
    return this.services.sessions.startUserTurn(input);
  }

  async completeUserTurn(caseId: string, userMessageId: string): Promise<AgentResponse> {
    return this.turnQueue.run(caseId, () => this.completeUserTurnNow(caseId, userMessageId));
  }

  recordTurnFailure(caseId: string, error: unknown, replyToMessageId?: string): void {
    this.services.sessions.recordTurnFailure(caseId, error, replyToMessageId);
  }

  recoverInterruptedTurns(): void {
    const cases = this.store.listCases(Number.MAX_SAFE_INTEGER);
    for (const caseSession of cases) {
      markInheritedActiveTurnsRetryable(caseSession, this.store);
    }
  }

  retryInterruptedTurn(caseId: string, userMessageId: string): { accepted: boolean; caseId: string; userMessageId: string } {
    const caseSession = this.store.loadCase(caseId);
    if (!caseSession) {
      throw new RetryableTurnError('case not found', 404);
    }
    if (caseSession.archivedAt) {
      throw new RetryableTurnError('session is archived and cannot continue', 409);
    }

    const interruption = findRetryableInterruption(caseSession);
    if (!interruption) {
      throw new RetryableTurnError('turn is not retryable', 409);
    }
    if (interruption.userMessageId !== userMessageId) {
      throw new RetryableTurnError('turn is not retryable', 409);
    }

    const userMessage = caseSession.messages.find((m) => m.id === userMessageId && m.role === 'user');
    if (!userMessage) {
      throw new RetryableTurnError('user message not found', 404);
    }

    removeInterruptionPlaceholder(caseSession, interruption.placeholderMessageId);

    this.store.addLogEvent(caseSession, {
      actor: 'system',
      phase: 'turn_retry_started',
      label: '重试开始',
      severity: 'ok',
      summary: '用户点击一键重试，正在重新执行原回合。',
      detail: { userMessageId },
    });

    caseSession.status = 'ready_for_diagnosis';
    this.store.saveCase(caseSession);

    void this.completeUserTurn(caseId, userMessageId).catch((error) => {
      this.recordTurnFailure(caseId, error, userMessageId);
    });

    return { accepted: true, caseId, userMessageId };
  }

  private async completeUserTurnNow(caseId: string, userMessageId: string): Promise<AgentResponse> {
    const caseSession = this.services.sessions.requireActiveCase(caseId);
    const userMessage = this.services.sessions.userMessageBody(caseSession, userMessageId);
    const replyToMessageId = userMessageId;

    bindTurnContextCutoff(caseSession, userMessageId);
    try {
      return await this.runTurnPipeline(caseSession, userMessage, replyToMessageId);
    } finally {
      clearTurnContextCutoff(caseSession);
    }
  }

  private async runTurnPipeline(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId: string,
  ): Promise<AgentResponse> {
    const curationResponse = this.services.caseCuration.answer(caseSession, userMessage, replyToMessageId);
    if (curationResponse) {
      return curationResponse;
    }

    const decision = await this.services.preflight.decide(caseSession, userMessage);
    if (decision.action === 'ask_user') {
      this.services.events.preflightAskUser(caseSession, decision);
      const reply = formatPreflightQuestion(decision.question, decision.missingInfo);
      this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
      this.services.events.preflightReplyCreated(caseSession, reply);
      this.store.appendDailyMemory(`- ${new Date().toISOString()} ${caseSession.id} preflight ask: ${decision.missingInfo.join(', ')}`);
      caseSession.status = 'need_input';
      this.store.saveCase(caseSession);
      return { caseSession, assistantMessage: reply, decision: 'ask_user' };
    }

    if (this.hasHistoricalCaseSource(decision.request.workspaceId)) {
      return this.services.caseInvestigation.answer(caseSession, decision.request, replyToMessageId);
    }

    const experienceResponse = await this.services.experienceTurn.answer(caseSession, decision.request, replyToMessageId);
    if (experienceResponse) {
      return experienceResponse;
    }

    const knowledgeResponse = await this.services.knowledgeTurn.answer(
      caseSession,
      decision.request.userGoal,
      replyToMessageId,
      decision.request,
    );
    if (knowledgeResponse) {
      return knowledgeResponse;
    }

    const mcpResult = await this.services.mcpEvidence.run(decision.request);
    if (decision.request.context?.mcp) {
      this.store.addLogEvent(caseSession, {
        actor: 'mcp',
        phase: 'mcp_evidence_completed',
        summary: `MCP evidence stage completed with ${decision.request.context.mcp.calls.length} bounded call(s).`,
        severity: decision.request.context.mcp.evidence.length > 0 ? 'ok' : 'warn',
        detail: {
          calls: decision.request.context.mcp.calls.map((call) => ({
            serverId: call.serverId,
            toolName: call.toolName,
            status: call.status,
            reason: call.reason,
            evidenceId: call.evidenceId,
          })),
        },
      });
    }
    if (mcpResult) {
      const run: DiagnosticRun = {
        id: decision.request.runId,
        caseId: caseSession.id,
        status: mcpResult.status,
        request: decision.request,
        result: mcpResult,
      };
      caseSession.status = 'diagnosing';
      this.store.addRun(caseSession, run);
      const review = await this.services.reviewer.reviewAndFormat(caseSession, mcpResult, run, {
        coverageEvidenceEnvelopes: this.services.mcpEvidence.currentCoverageEvidence(decision.request)
          .map((item) => ({
            ...item,
            kind: 'mcp' as const,
            freshness: 'current_mcp_call' as const,
          })),
      });
      return completePresentedTurn({
        store: this.store,
        events: this.services.events,
        caseSession,
        review,
        replyToMessageId,
      });
    }

    const review = await this.services.workerDiagnosis.diagnose(caseSession, decision.request);
    return completePresentedTurn({
      store: this.store,
      events: this.services.events,
      caseSession,
      review,
      replyToMessageId,
    });
  }

  private hasHistoricalCaseSource(workspaceId: string): boolean {
    return this.config.workspaces.some((workspace) => (
      workspace.id === workspaceId && workspace.historicalCaseSources?.length === 1
    ));
  }
}

export class RetryableTurnError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'RetryableTurnError';
  }
}
