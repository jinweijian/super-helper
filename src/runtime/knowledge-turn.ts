import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticRequest, DiagnosticRun } from '../domain.js';
import { resolveKnowledgeWorkspaceRoot } from '../knowledge/index.js';
import type { FileMemoryStore, StoredCase } from '../storage.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import {
  attachKnowledgeCodeEscalationContext,
  diagnosticResultFromKnowledge,
  prepareKnowledgeDiagnosis,
} from './knowledge-diagnosis.js';
import { caseStatusFromDiagnosticResult } from './review-gate.js';
import { ReviewPresentationService } from './review-presentation.js';

export class KnowledgeTurnService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: FileMemoryStore,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
  ) {}

  async answer(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId: string | undefined,
    request: DiagnosticRequest,
  ): Promise<RuntimeTurnResponse | undefined> {
    const workspaceRoot = resolveKnowledgeWorkspaceRoot(this.config, caseSession.workspaceId);
    this.events.knowledgeRouterStarted(caseSession, userMessage);
    const diagnosis = await prepareKnowledgeDiagnosis({
      config: this.config,
      workspaceRoot,
      question: userMessage,
      persona: caseSession.userPersona,
    });
    if (!diagnosis) {
      return undefined;
    }

    const { route, evidencePack, judge } = diagnosis;
    this.events.knowledgeRouterResult(caseSession, route);
    this.events.knowledgeSearchStarted(caseSession, {
      workspaceRoot,
      query: userMessage,
      moduleCandidates: route.moduleCandidates,
      intentCandidates: route.intentCandidates,
      sourceTypes: route.sourceTypes,
    });
    this.events.knowledgeSearchResult(caseSession, evidencePack);
    this.events.evidenceJudgeStarted(caseSession, evidencePack);
    this.events.evidenceJudgeResult(caseSession, judge);

    if (!judge.answerable || judge.need_code_escalation) {
      attachKnowledgeCodeEscalationContext({
        request,
        question: userMessage,
        route,
        evidencePack,
        judge,
      });
      this.events.codeEscalationRequested(caseSession, request);
      return undefined;
    }

    const result = diagnosticResultFromKnowledge({ evidencePack, judge, route });
    const run: DiagnosticRun = {
      id: request.runId,
      caseId: caseSession.id,
      status: result.status,
      request,
      result,
    };
    this.store.addRun(caseSession, run);
    caseSession.status = caseStatusFromDiagnosticResult(result);
    this.store.saveCase(caseSession);
    this.events.knowledgeAnswerSelected(caseSession, result);
    const review = await this.reviewer.reviewAndFormat(caseSession, result, run);
    this.events.presentationPrepared(caseSession, review.decision);
    this.store.addMessage(caseSession, { role: 'helper', body: review.reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, review.reply, review.decision);
    return { caseSession, assistantMessage: review.reply, decision: review.decision };
  }
}
