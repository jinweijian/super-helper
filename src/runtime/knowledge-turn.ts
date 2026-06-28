import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticRequest, DiagnosticRun } from '../domain.js';
import { resolveKnowledgeWorkspaceRoot } from '../knowledge/index.js';
import type { FileMemoryStore, StoredCase } from '../sessions/file-memory-store.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { EvidenceCoverageService } from './evidence-coverage-service.js';
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
    private readonly coverageService?: EvidenceCoverageService,
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

    const { route, evidencePack, judge, retrievalTrace, glossaryTerms } = diagnosis;
    this.events.knowledgeRouterResult(caseSession, route);
    this.events.knowledgeSearchStarted(caseSession, {
      workspaceRoot,
      query: userMessage,
      moduleCandidates: route.moduleCandidates,
      intentCandidates: route.intentCandidates,
      sourceTypes: route.sourceTypes,
    });
    this.events.knowledgeSearchResult(caseSession, evidencePack);
    this.events.knowledgeRetrievalTrace(caseSession, retrievalTrace);
    this.events.evidenceJudgeStarted(caseSession, evidencePack);
    this.events.evidenceJudgeResult(caseSession, judge);

    if (this.coverageService && this.config.agent.useModelForEvidenceCoverage !== false && judge.answerable && evidencePack.results[0]) {
      const topScore = evidencePack.results[0].retrieval?.rerankScore ?? 0;
      if (topScore >= 0.7) {
        this.events.evidenceCoverageStarted(caseSession, {
          question: userMessage,
          evidenceIds: evidencePack.results.slice(0, 3).map((item) => item.evidence_id),
        });
        const coverage = await this.coverageService.evaluate({
          question: userMessage,
          evidence: evidencePack.results,
        });
        if (coverage.coverage === 'not_covered' || coverage.coverage === 'partial') {
          judge.answerable = false;
          judge.need_code_escalation = true;
          judge.blockers.push('question_not_answered');
          judge.ambiguity.push(`证据未覆盖原问题答案要素：${coverage.missingElements.join('、') || '关键要素缺失'}`);
          judge.recommended_next_action = 'dispatch_code_diagnosis';
          judge.confidence = 'low';
          judge.reason = coverage.reason || '知识证据未覆盖原问题答案要素，拒绝直答。';
        }
        this.events.evidenceCoverageResult(caseSession, coverage);
      }
    }

    if (!judge.answerable || judge.need_code_escalation) {
      attachKnowledgeCodeEscalationContext({
        request,
        question: userMessage,
        route,
        evidencePack,
        judge,
        projectType: this.config.knowledge.projectType,
        glossaryTerms,
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
    this.events.preflightKnowledgeAnswer(caseSession, result);
    this.events.knowledgeAnswerSelected(caseSession, result);
    const review = await this.reviewer.reviewAndFormat(caseSession, result, run);
    this.events.presentationPrepared(caseSession, review.decision);
    this.store.addMessage(caseSession, { role: 'helper', body: review.reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, review.reply, review.decision);
    return { caseSession, assistantMessage: review.reply, decision: review.decision };
  }
}
