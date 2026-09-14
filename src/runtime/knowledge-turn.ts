import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticRequest, DiagnosticRun, DiagnosticResult } from '../domain.js';
import {
  readActiveKnowledgeGeneration,
  readKnowledgeChunks,
  resolveKnowledgeWorkspaceRoot,
} from '../knowledge/index.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { RuntimeTurnResponse } from './contracts.js';
import type { CoverageEvidenceEnvelope } from './coverage-evidence-provenance.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { RagAnswerabilityService, type RagAnswerabilityResult } from './rag-answerability-service.js';
import { throwIfInvestigationCancelled } from './investigation-cancellation.js';
import {
  attachKnowledgeCodeEscalationContext,
  diagnosticResultFromKnowledge,
  prepareKnowledgeDiagnosis,
} from './knowledge-diagnosis.js';
import type { EvidenceJudgeBlocker } from './evidence-judge.js';
import { ReviewPresentationService } from './review-presentation.js';
import { completePresentedTurn } from './turn-completion.js';

type PreparedKnowledgeDiagnosis = NonNullable<Awaited<ReturnType<typeof prepareKnowledgeDiagnosis>>>;

export interface KnowledgeCollectionOutcome {
  status: 'completed' | 'no_hit';
  route?: PreparedKnowledgeDiagnosis['route'];
  evidencePack?: PreparedKnowledgeDiagnosis['evidencePack'];
  judge?: PreparedKnowledgeDiagnosis['judge'];
  answerability?: RagAnswerabilityResult;
  result?: DiagnosticResult;
  coverageEvidenceEnvelopes: CoverageEvidenceEnvelope[];
  requestPatch?: Pick<DiagnosticRequest, 'context' | 'knownFacts' | 'unknowns' | 'constraints'>;
}

export class KnowledgeTurnService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: CaseRepository,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
    private readonly ragAnswerabilityService?: RagAnswerabilityService,
  ) {}

  async collect(
    caseSession: StoredCase,
    userMessage: string,
    request: DiagnosticRequest,
    signal?: AbortSignal,
  ): Promise<KnowledgeCollectionOutcome> {
    throwIfInvestigationCancelled(signal);
    const workspaceRoot = resolveKnowledgeWorkspaceRoot(this.config, caseSession.workspaceId);
    this.events.knowledgeRouterStarted(caseSession, userMessage);
    const diagnosis = await prepareKnowledgeDiagnosis({
      config: this.config,
      workspaceRoot,
      question: userMessage,
      persona: caseSession.userPersona,
    });
    throwIfInvestigationCancelled(signal);
    if (!diagnosis) return { status: 'no_hit', coverageEvidenceEnvelopes: [] };

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

    let answerability: RagAnswerabilityResult | undefined;
    const answerGoal = request.answerGoal;
    if (
      this.ragAnswerabilityService &&
      this.config.agent.useModelForRagAnswerability !== false &&
      this.config.agent.modelProvider &&
      evidencePack.results[0]
    ) {
      this.events.ragAnswerabilityStarted(caseSession, {
        answerObject: answerGoal.answerObject,
        evidenceIds: evidencePack.results.slice(0, 3).map((item) => item.evidence_id),
      });
      answerability = await this.ragAnswerabilityService.evaluate({
        answerGoal,
        evidence: evidencePack.results,
      }, signal);
      throwIfInvestigationCancelled(signal);
      this.events.ragAnswerabilityResult(caseSession, answerability);
    }

    const ragBlocksDirectAnswer = Boolean(answerability && answerability.answerability !== 'full');
    const questionNotAnsweredBlocker: EvidenceJudgeBlocker = 'question_not_answered';
    const finalJudge = {
      ...judge,
      answerable: judge.answerable && !ragBlocksDirectAnswer,
      need_code_escalation: judge.need_code_escalation || ragBlocksDirectAnswer,
      confidence: ragBlocksDirectAnswer ? 'low' as const : judge.confidence,
      reason: ragBlocksDirectAnswer ? answerability?.reason || judge.reason : judge.reason,
      blockers: ragBlocksDirectAnswer
        ? Array.from(new Set([...judge.blockers, questionNotAnsweredBlocker]))
        : judge.blockers,
      ambiguity: ragBlocksDirectAnswer
        ? Array.from(new Set([
          ...judge.ambiguity,
          `RAG Answerability 缺失答案要素：${answerability?.missingElements.join('、') || '关键要素缺失'}`,
        ]))
        : judge.ambiguity,
      recommended_next_action: ragBlocksDirectAnswer ? 'dispatch_code_diagnosis' : judge.recommended_next_action,
    };

    if (!finalJudge.answerable || finalJudge.need_code_escalation) {
      const patchedRequest = structuredClone(request);
      attachKnowledgeCodeEscalationContext({
        request: patchedRequest,
        question: userMessage,
        route,
        evidencePack,
        judge: finalJudge,
        answerability,
        projectType: this.config.knowledge.projectType,
        glossaryTerms,
      });
      this.events.codeEscalationRequested(caseSession, patchedRequest);
      return {
        status: 'completed',
        route,
        evidencePack,
        judge: finalJudge,
        answerability,
        coverageEvidenceEnvelopes: knowledgeCoverageEnvelopes(workspaceRoot, diagnosis),
        requestPatch: {
          context: patchedRequest.context,
          knownFacts: patchedRequest.knownFacts,
          unknowns: patchedRequest.unknowns,
          constraints: patchedRequest.constraints,
        },
      };
    }

    return {
      status: 'completed',
      route,
      evidencePack,
      judge: finalJudge,
      answerability,
      result: diagnosticResultFromKnowledge({
        evidencePack,
        judge: finalJudge,
        route,
        answerability,
        answerGoal,
      }),
      coverageEvidenceEnvelopes: knowledgeCoverageEnvelopes(workspaceRoot, diagnosis),
    };
  }

  async answer(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId: string | undefined,
    request: DiagnosticRequest,
    signal?: AbortSignal,
  ): Promise<RuntimeTurnResponse | undefined> {
    const collected = await this.collect(caseSession, userMessage, request, signal);
    throwIfInvestigationCancelled(signal);
    if (collected.requestPatch) applyRequestPatch(request, collected.requestPatch);
    if (!collected.result) return undefined;
    const result = collected.result;
    const run: DiagnosticRun = {
      id: request.runId,
      caseId: caseSession.id,
      status: 'running',
      request,
      result,
    };
    caseSession.status = 'diagnosing';
    this.store.addRun(caseSession, run);
    this.events.preflightKnowledgeAnswer(caseSession, result);
    this.events.knowledgeAnswerSelected(caseSession, result);
    const review = await this.reviewer.reviewAndFormat(caseSession, result, run, {
      signal,
      coverageEvidenceEnvelopes: collected.coverageEvidenceEnvelopes,
    });
    return completePresentedTurn({
      store: this.store,
      events: this.events,
      caseSession,
      review,
      replyToMessageId,
    });
  }
}

function knowledgeCoverageEnvelopes(
  workspaceRoot: string,
  diagnosis: PreparedKnowledgeDiagnosis,
): CoverageEvidenceEnvelope[] {
  const activeGeneration = readActiveKnowledgeGeneration(workspaceRoot);
  const requestGenerationId = diagnosis.retrievalTrace.generationId;
  const chunksById = new Map(readKnowledgeChunks(workspaceRoot, requestGenerationId).chunks
    .map((chunk) => [chunk.chunk_id, chunk]));
  return diagnosis.evidencePack.results.flatMap((item) => {
    const chunk = item.chunk_id ? chunksById.get(item.chunk_id) : undefined;
    const safeText = item.answer_span ?? item.excerpt;
    if (
      !chunk || chunk.legacy || chunk.artifact_version !== 4 ||
      chunk.chunking_strategy !== 'parent-child-v4' || chunk.undersized_unmergeable ||
      chunk.manual_split_required || !activeGeneration || !requestGenerationId ||
      activeGeneration.generation_id !== requestGenerationId || !safeText
    ) return [];
    return [{
      evidenceId: item.evidence_id,
      kind: 'knowledge' as const,
      safeText,
      freshness: 'current_knowledge_v4' as const,
      validated: true,
      generationId: requestGenerationId,
      currentGenerationId: activeGeneration.generation_id,
      strictEligible: item.status === 'active' && item.quality?.severity === 'ok' && !(item.grounding_issues?.length),
    }];
  });
}

function applyRequestPatch(
  request: DiagnosticRequest,
  patch: Pick<DiagnosticRequest, 'context' | 'knownFacts' | 'unknowns' | 'constraints'>,
): void {
  request.context = patch.context;
  request.knownFacts = [...patch.knownFacts];
  request.unknowns = [...patch.unknowns];
  request.constraints = [...patch.constraints];
}
