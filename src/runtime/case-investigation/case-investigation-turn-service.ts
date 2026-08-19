import type { DiagnosticRequest, DiagnosticResult, DiagnosticRun, Evidence } from '../../domain.js';
import { sanitizeWorkerTrace } from '../../observability/worker-trace.js';
import type { CaseRepository, StoredCase } from '../../sessions/case-repository.js';
import type { RuntimeTurnResponse } from '../contracts.js';
import type { CoverageEvidenceEnvelope } from '../coverage-evidence-provenance.js';
import type { CaseRuntimeEventRecorder } from '../event-recorder.js';
import type { ReviewGlobalBlocker } from '../review-gate.js';
import type { ReviewPresentationService } from '../review-presentation.js';
import { completePresentedTurn } from '../turn-completion.js';
import type { HistoricalCaseVerifierService } from './historical-case-verifier-service.js';
import { gateHistoricalCases } from './historical-case-gate.js';
import type { ParallelSourceCollector, ParallelSourceOutcome } from './parallel-source-collector.js';
import { buildCaseInvestigationResult } from './result-builder.js';
import type { WorkerVerification, WorkerVerificationOutcome } from './worker-verification.js';

export class CaseInvestigationTurnService {
  private readonly store: CaseRepository;
  private readonly events: CaseRuntimeEventRecorder;
  private readonly reviewer: Pick<ReviewPresentationService, 'reviewAndFormat'>;
  private readonly collector: Pick<ParallelSourceCollector, 'collect'>;
  private readonly workerVerification: Pick<WorkerVerification, 'collect'>;
  private readonly verifier: Pick<HistoricalCaseVerifierService, 'verify'>;

  constructor(input: {
    store: CaseRepository;
    events: CaseRuntimeEventRecorder;
    reviewer: Pick<ReviewPresentationService, 'reviewAndFormat'>;
    collector: Pick<ParallelSourceCollector, 'collect'>;
    workerVerification: Pick<WorkerVerification, 'collect'>;
    verifier: Pick<HistoricalCaseVerifierService, 'verify'>;
  }) {
    this.store = input.store;
    this.events = input.events;
    this.reviewer = input.reviewer;
    this.collector = input.collector;
    this.workerVerification = input.workerVerification;
    this.verifier = input.verifier;
  }

  async answer(
    caseSession: StoredCase,
    request: DiagnosticRequest,
    replyToMessageId?: string,
  ): Promise<RuntimeTurnResponse> {
    const sources = await this.collector.collect(caseSession, request);
    const mergedRequest = mergeCollectorRequestPatch(request, sources);
    const knowledgeResult = 'result' in sources.knowledge ? sources.knowledge.result : undefined;
    const experienceMatch = 'match' in sources.experience ? sources.experience.match : undefined;
    const needsFallbackWorker = sources.redmine.leads.length === 0 && !knowledgeResult && !experienceMatch;
    const workerInvoked = sources.redmine.leads.length > 0 || needsFallbackWorker;
    const workerStartedAt = Date.now();
    this.events.currentProjectVerificationStarted(caseSession, {
      runId: request.runId, workerInvoked, leadCount: sources.redmine.leads.length,
    });
    const worker = await this.workerVerification.collect({
      request: mergedRequest,
      leads: sources.redmine.leads,
      needsFallbackWorker,
    });
    const workerEvidence = worker.status === 'completed' ? worker.response.result.evidence : [];
    this.events.currentProjectVerificationCompleted(caseSession, {
      runId: request.runId, status: worker.status, workerInvoked,
      evidenceCount: workerEvidence.length, evidenceIds: workerEvidence.map((item) => item.id),
      durationMs: Date.now() - workerStartedAt,
    });
    const currentEvidence = worker.status === 'completed'
      ? worker.response.result.evidence.filter((item) => item.kind === 'workspace' || item.kind === 'log')
      : [];
    const verificationStartedAt = Date.now();
    this.events.historicalCrossReviewStarted(caseSession, { runId: request.runId, leadCount: sources.redmine.leads.length });
    const verification = sources.redmine.leads.length > 0
      ? await this.verifier.verify({
          leads: sources.redmine.leads,
          historicalEvidence: sources.redmine.evidence,
          currentEvidence,
        })
      : { verifications: [], degraded: false };
    const classifications = verification.verifications.map((item) => item.classification);
    this.events.historicalCrossReviewCompleted(caseSession, {
      runId: request.runId,
      verificationCount: verification.verifications.length,
      classificationCounts: {
        sameRootCauseLikely: classifications.filter((item) => item === 'same_root_cause_likely').length,
        sameSymptomDifferentCause: classifications.filter((item) => item === 'same_symptom_different_cause').length,
        diagnosticLeadOnly: classifications.filter((item) => item === 'diagnostic_lead_only').length,
        irrelevant: classifications.filter((item) => item === 'irrelevant').length,
      },
      evidenceIds: [...new Set(verification.verifications.flatMap((item) => [...item.supportingEvidenceIds, ...item.conflictingEvidenceIds]))],
      durationMs: Date.now() - verificationStartedAt,
      degraded: verification.degraded,
    });
    const evidence = uniqueEvidence([
      ...(knowledgeResult?.evidence ?? []),
      ...(experienceMatch?.result.evidence ?? []),
      ...sources.redmine.evidence,
      ...(worker.status === 'completed' ? worker.response.result.evidence : []),
    ]);
    const coverageEvidenceEnvelopes = uniqueEnvelopes([
      ...sources.knowledge.coverageEvidenceEnvelopes,
      ...(experienceMatch?.coverageEvidenceEnvelopes ?? []),
      ...sources.redmine.coverageEvidenceEnvelopes,
      ...(worker.status === 'completed' ? worker.coverageEvidenceEnvelopes : []),
    ]);
    const gate = gateHistoricalCases({
      currentRunId: request.runId,
      redmineStatus: sources.redmine.status,
      workerStatus: worker.status,
      knowledgeConflicts: Boolean('judge' in sources.knowledge && sources.knowledge.judge?.conflicts.length),
      leads: sources.redmine.leads,
      verifications: verification.verifications,
      evidence,
      coverageEvidenceEnvelopes,
    });
    const fallbackResult = knowledgeResult
      ?? experienceMatch?.result
      ?? (worker.status === 'completed' ? worker.response.result : undefined);
    const result = buildCaseInvestigationResult({
      answerGoal: request.answerGoal,
      gate,
      evidence,
      fallbackResult,
    });
    const persistedRequest = worker.status === 'completed'
      ? worker.persistedRequest
      : mergedRequest;
    const run: DiagnosticRun = {
      id: request.runId,
      caseId: caseSession.id,
      status: result.status,
      request: persistedRequest,
      result,
      ...(worker.status === 'completed'
        ? { workerTrace: metadataOnlyTrace(worker.response.trace) }
        : {}),
    };
    caseSession.status = 'diagnosing';
    this.store.addRun(caseSession, run);
    this.events.preflightDispatch(caseSession, persistedRequest);
    this.events.diagnosticRequestCreated(caseSession, persistedRequest);
    this.store.appendDailyMemory(`- ${new Date().toISOString()} ${caseSession.id} case investigation ${run.id}`);
    const review = await this.reviewer.reviewAndFormat(caseSession, result, run, {
      coverageEvidenceEnvelopes,
      upstreamBlockers: gate.blockers.map((code): ReviewGlobalBlocker => ({ code: `historical_case:${code}` })),
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

function mergeCollectorRequestPatch(
  request: DiagnosticRequest,
  sources: ParallelSourceOutcome,
): DiagnosticRequest {
  const merged = structuredClone(request);
  if ('requestPatch' in sources.knowledge && sources.knowledge.requestPatch) {
    merged.context = sources.knowledge.requestPatch.context;
    merged.knownFacts = [...sources.knowledge.requestPatch.knownFacts];
    merged.unknowns = [...sources.knowledge.requestPatch.unknowns];
    merged.constraints = [...sources.knowledge.requestPatch.constraints];
  }
  if (sources.experience.rejectedCandidates.length > 0) {
    merged.context ??= {
      isFollowUp: false,
      currentUserMessage: merged.userGoal,
      recentMessages: [],
      previousRuns: [],
    };
    merged.context.experienceCandidates = sources.experience.rejectedCandidates;
  }
  return merged;
}

function uniqueEvidence(evidence: Evidence[]): Evidence[] {
  const byId = new Map<string, Evidence>();
  for (const item of evidence) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()];
}

function uniqueEnvelopes(envelopes: CoverageEvidenceEnvelope[]): CoverageEvidenceEnvelope[] {
  const byId = new Map<string, CoverageEvidenceEnvelope>();
  for (const item of envelopes) if (!byId.has(item.evidenceId)) byId.set(item.evidenceId, item);
  return [...byId.values()];
}

function metadataOnlyTrace(trace: Parameters<typeof sanitizeWorkerTrace>[0]) {
  const safe = sanitizeWorkerTrace(trace);
  return { ...safe, stdout: '', stderr: '' };
}
