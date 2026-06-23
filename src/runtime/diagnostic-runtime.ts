import type { ClaudeWorker } from '../claude-worker.js';
import type { SuperHelperConfig } from '../config.js';
import { getModelProvider } from '../config.js';
import type { UserPersona } from '../domain.js';
import { createModelClient } from '../model.js';
import type { FileMemoryStore, StoredCase } from '../storage.js';
import { resolveAgentConfig } from './agent-configs.js';
import { CaseCurationService } from './case-curation-service.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { ExperienceTurnService } from './experience-turn.js';
import { KnowledgeTurnService } from './knowledge-turn.js';
import { PreflightService } from './preflight-service.js';
import { formatPreflightQuestion } from './presenter.js';
import { ReviewPresentationService } from './review-presentation.js';
import { SessionLifecycle } from './session-lifecycle.js';
import { CaseTurnQueue } from './turn-queue.js';
import { WorkerDiagnosisService } from './worker-diagnosis.js';

export interface AgentResponse extends RuntimeTurnResponse {}

export class DiagnosticRuntime {
  private readonly events: CaseRuntimeEventRecorder;
  private readonly turnQueue = new CaseTurnQueue();
  private readonly sessions: SessionLifecycle;
  private readonly preflight: PreflightService;
  private readonly experienceTurn: ExperienceTurnService;
  private readonly knowledgeTurn: KnowledgeTurnService;
  private readonly workerDiagnosis: WorkerDiagnosisService;
  private readonly reviewer: ReviewPresentationService;
  private readonly caseCuration: CaseCurationService;

  constructor(
    config: SuperHelperConfig,
    private readonly store: FileMemoryStore,
    worker: ClaudeWorker,
  ) {
    const model = createModelClient(getModelProvider(config));
    const mainAgentSpec = resolveAgentConfig('main').content;
    const inputReviewAgentSpec = resolveAgentConfig('preflight').content;
    const experienceAgentSpec = resolveAgentConfig('experience').content;
    const outputReviewAgentSpec = resolveAgentConfig('output_review').content;
    const presentationAgentSpec = resolveAgentConfig('presentation').content;

    this.events = new CaseRuntimeEventRecorder(store);
    this.reviewer = new ReviewPresentationService(
      config,
      model,
      this.events,
      mainAgentSpec,
      outputReviewAgentSpec,
      presentationAgentSpec,
    );
    this.sessions = new SessionLifecycle(config, store, this.events);
    this.preflight = new PreflightService(
      config,
      store,
      model,
      this.events,
      mainAgentSpec,
      inputReviewAgentSpec,
      experienceAgentSpec,
    );
    this.experienceTurn = new ExperienceTurnService(store, this.events, this.reviewer);
    this.knowledgeTurn = new KnowledgeTurnService(config, store, this.events, this.reviewer);
    this.workerDiagnosis = new WorkerDiagnosisService(store, worker, this.events, this.reviewer);
    this.caseCuration = new CaseCurationService(config, store, this.events);
  }

  async handleUserMessage(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): Promise<AgentResponse> {
    const caseSession = this.startUserTurn(input);
    return this.completeUserTurn(caseSession.id, input.message);
  }

  loadCase(caseId: string): StoredCase | undefined {
    return this.sessions.loadCase(caseId);
  }

  startUserTurn(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): StoredCase {
    return this.sessions.startUserTurn(input);
  }

  async completeUserTurn(caseId: string, userMessage: string): Promise<AgentResponse> {
    return this.turnQueue.run(caseId, () => this.completeUserTurnNow(caseId, userMessage));
  }

  recordTurnFailure(caseId: string, error: unknown, replyToMessageId?: string): void {
    this.sessions.recordTurnFailure(caseId, error, replyToMessageId);
  }

  private async completeUserTurnNow(caseId: string, userMessage: string): Promise<AgentResponse> {
    const caseSession = this.sessions.requireActiveCase(caseId);
    const replyToMessageId = this.sessions.pendingUserMessageId(caseSession, userMessage);

    const curationResponse = this.caseCuration.answer(caseSession, userMessage, replyToMessageId);
    if (curationResponse) {
      return curationResponse;
    }

    const decision = await this.preflight.decide(caseSession, userMessage);
    if (decision.action === 'ask_user') {
      this.events.preflightAskUser(caseSession, decision);
      const reply = formatPreflightQuestion(decision.question, decision.missingInfo);
      this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
      this.events.preflightReplyCreated(caseSession, reply);
      this.store.appendDailyMemory(`- ${new Date().toISOString()} ${caseSession.id} preflight ask: ${decision.missingInfo.join(', ')}`);
      caseSession.status = 'need_input';
      this.store.saveCase(caseSession);
      return { caseSession, assistantMessage: reply, decision: 'ask_user' };
    }

    const experienceResponse = await this.experienceTurn.answer(caseSession, decision.request, replyToMessageId);
    if (experienceResponse) {
      return experienceResponse;
    }

    const knowledgeResponse = await this.knowledgeTurn.answer(
      caseSession,
      decision.request.userGoal,
      replyToMessageId,
      decision.request,
    );
    if (knowledgeResponse) {
      return knowledgeResponse;
    }

    const review = await this.workerDiagnosis.diagnose(caseSession, decision.request);
    this.events.presentationPrepared(caseSession, review.decision);
    this.store.addMessage(caseSession, { role: 'helper', body: review.reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, review.reply, review.decision);
    return { caseSession, assistantMessage: review.reply, decision: review.decision };
  }
}
