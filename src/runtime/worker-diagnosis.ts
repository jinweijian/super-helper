import type { ClaudeWorkerResponse, DiagnosticRequest, DiagnosticResult } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { DiagnosticWorker } from '../workers/diagnostic-worker.js';
import type { ReviewPresentationResult } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { buildFollowUpDiagnosticRequest } from './request-builder.js';
import { shouldRunFollowUp } from './review-gate.js';
import { ReviewPresentationService } from './review-presentation.js';
import {
  applyWorkerResponseToRun,
  createRunningDiagnosticRun,
  prepareDeepQueryRetry,
} from './worker-turn.js';
import type { CoverageEvidenceEnvelope } from './coverage-evidence-provenance.js';
import type { HistoricalLead, ReadOnlyCheckAction } from './case-investigation/contracts.js';
import type { SuperHelperConfig } from '../config.js';
import type { InvestigationControl } from './investigation-control.js';
import { resolveInvestigation, nextInvestigation, hasEvidenceProgress } from './investigation-policy.js';
import { recordInvestigationMode } from './event-recorder/investigation.js';
import { InvestigationCancelled } from './investigation-cancellation.js';

const READ_ONLY_ACTIONS = new Set<ReadOnlyCheckAction>([
  'read_file',
  'search_workspace',
  'inspect_config',
  'inspect_log',
  'run_read_only_command',
]);

export type WorkerEvidenceCollectionOutcome =
  | {
      status: 'completed';
      response: ClaudeWorkerResponse;
      persistedRequest: DiagnosticRequest;
      coverageEvidenceEnvelopes: CoverageEvidenceEnvelope[];
    }
  | { status: 'rejected' | 'failed'; safeErrorCode: string };

export class WorkerDiagnosisService {
  constructor(
    private readonly store: CaseRepository,
    private readonly worker: DiagnosticWorker,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
    private readonly investigation?: { config: SuperHelperConfig; control?: InvestigationControl },
  ) {}

  async collectEvidence(input: {
    request: DiagnosticRequest;
    leads: HistoricalLead[];
  }): Promise<WorkerEvidenceCollectionOutcome> {
    if (!validWorkerLeads(input.leads)) {
      return { status: 'rejected', safeErrorCode: 'unsafe_worker_action' };
    }
    const workerRequest = structuredClone(input.request);
    this.prepareInvestigation(workerRequest, true);
    workerRequest.constraints = Array.from(new Set([
      ...workerRequest.constraints,
      'Historical case verification is read-only. Do not query or mutate Redmine. Check both supporting and contradicting conditions.',
      ...input.leads.flatMap((lead) => lead.checks.map((check) => (
        `Historical check ${check.id}: action=${check.action}; target=${check.target}; expected_match=${check.expectedMatch}; expected_mismatch=${check.expectedMismatch}`
      ))),
    ]));
    const persistedRequest = { ...structuredClone(input.request), investigation: workerRequest.investigation };
    try {
      const response = await this.execute(workerRequest);
      return {
        status: 'completed',
        response,
        persistedRequest,
        coverageEvidenceEnvelopes: workerCoverageEnvelopes(response),
      };
    } catch (error) {
      if (error instanceof InvestigationCancelled) throw error;
      return { status: 'failed', safeErrorCode: 'worker_failure' };
    }
  }

  async diagnose(caseSession: StoredCase, request: DiagnosticRequest): Promise<ReviewPresentationResult> {
    this.prepareInvestigation(request);
    if (request.investigation) {
      const preference = request.investigation.requestedMode;
      recordInvestigationMode(this.store, caseSession, request.investigation, resolveInvestigation(preference, request).reasonCode);
    }
    caseSession.status = 'diagnosing';
    this.events.preflightDispatch(caseSession, request);
    const run = createRunningDiagnosticRun({ request, caseId: caseSession.id });
    this.store.addRun(caseSession, run);
    this.events.diagnosticRequestCreated(caseSession, request);
    this.store.appendDailyMemory(`- ${new Date().toISOString()} ${caseSession.id} dispatch ${run.id}`);

    const workerResponse = await this.execute(request);
    const result = applyWorkerResponseToRun({ run, response: workerResponse });
    caseSession.status = 'diagnosing';
    this.store.saveCase(caseSession);
    this.events.workerTrace(caseSession, workerResponse.trace);

    let review = await this.reviewer.reviewAndFormat(caseSession, result, run, {
      coverageEvidenceEnvelopes: workerCoverageEnvelopes(workerResponse),
    });
    if (this.investigation?.control?.options(request.caseId).signal?.aborted) return this.cancelledReview(review, run.result);
    const escalation = request.investigation && !workerResponse.trace.error ? nextInvestigation(request.investigation, review.decision) : undefined;
    if (request.investigation && !escalation && (
      request.investigation.resolvedProfile === 'fast' ||
      !hasEvidenceProgress(request, run.result ?? result)
    )) return review;
    if (!escalation && !shouldRunFollowUp(review, result, workerResponse.trace)) {
      return review;
    }

    const deepRetry = prepareDeepQueryRetry({
      previousRequest: request,
      previousResult: result,
      workerTrace: workerResponse.trace,
      reviewDecision: review.decision,
    });
    if (deepRetry.stop && !escalation) {
      this.events.deepQueryStopped(caseSession, deepRetry.stop);
      return review;
    }

    this.events.followUpDiagnosticRequested(caseSession, run, result);
    const followUpRequest = buildFollowUpDiagnosticRequest({
      caseSession,
      previousRequest: request,
      previousResult: result,
    });
    if (escalation) {
      followUpRequest.investigation = escalation;
      this.investigation?.control?.setExecution(request.caseId, escalation);
      recordInvestigationMode(this.store, caseSession, escalation, 'fast_review_incomplete');
    }
    if (deepRetry.retry) {
      followUpRequest.context ??= {
        isFollowUp: true,
        currentUserMessage: followUpRequest.userGoal,
        recentMessages: [],
        previousRuns: [],
      };
      followUpRequest.context.knowledge = request.context?.knowledge;
      followUpRequest.context.deepQuery = deepRetry.retry.deepQuery;
      followUpRequest.constraints = Array.from(new Set([
        ...followUpRequest.constraints,
        'Deep Query retry: continue read-only investigation with the pivoted artifact targets.',
        `Pivot artifact targets: ${deepRetry.retry.deepQuery.artifactTargets.join(', ')}`,
        `Correction actions: ${deepRetry.retry.deepQuery.correctionActions.join(', ')}`,
      ]));
      this.events.deepQueryRetryRequested(caseSession, {
        attempt: deepRetry.retry.deepQuery.attempt ?? 2,
        maxAttempts: deepRetry.retry.deepQuery.maxAttempts ?? 2,
        previousArtifactTargets: deepRetry.retry.deepQuery.previousArtifactTargets ?? [],
        nextArtifactTargets: deepRetry.retry.deepQuery.artifactTargets,
        failedReasons: deepRetry.retry.deepQuery.failedReasons ?? [],
        correctionActions: deepRetry.retry.deepQuery.correctionActions,
      });
      this.events.deepQueryPivotSelected(caseSession, {
        attempt: deepRetry.retry.deepQuery.attempt ?? 2,
        previousArtifactTargets: deepRetry.retry.deepQuery.previousArtifactTargets ?? [],
        nextArtifactTargets: deepRetry.retry.deepQuery.artifactTargets,
        correctionActions: deepRetry.retry.deepQuery.correctionActions,
      });
    }

    const followUpRun = createRunningDiagnosticRun({
      request: followUpRequest,
      caseId: caseSession.id,
    });
    this.store.addRun(caseSession, followUpRun);
    this.events.diagnosticRequestCreated(caseSession, followUpRequest, { followUp: true });
    let followUpResponse: ClaudeWorkerResponse;
    try {
      followUpResponse = await this.execute(followUpRequest);
    } catch (error) {
      if (!(error instanceof InvestigationCancelled)) throw error;
      followUpRun.status = 'partial';
      return this.cancelledReview(review, run.result);
    }
    applyWorkerResponseToRun({ run: followUpRun, response: followUpResponse });
    caseSession.status = 'diagnosing';
    this.store.saveCase(caseSession);
    this.events.workerTrace(caseSession, followUpResponse.trace);
    const previousReview = review;
    review = await this.reviewer.reviewAndFormat(caseSession, followUpResponse.result, followUpRun, {
      coverageEvidenceEnvelopes: workerCoverageEnvelopes(followUpResponse),
    });
    if (review.decision !== 'final' && !usableReviewedClaims(followUpRun.result) && usableReviewedClaims(run.result)) {
      review = { ...previousReview, reply: '初步判断（深度排查未补齐证据，不能作为最终结论）：\n\n' + previousReview.reply, decision: 'partial', caseStatus: 'partial' };
    }
    if (this.investigation?.control?.options(request.caseId).signal?.aborted) return this.cancelledReview(review, followUpRun.result);
    return review;
  }

  private prepareInvestigation(request: DiagnosticRequest, historical = false): void {
    if (!this.investigation?.config.claude.investigationProfiles?.enabled) return;
    const caseSession = this.store.loadCase(request.caseId);
    const sourceIds = request.answerGoal.sourceMessageIds;
    const original = caseSession?.messages.filter(message => message.role === 'user' && sourceIds.includes(message.id)).at(-1);
    const preference = this.investigation.control?.preference(request.caseId) ?? original?.investigationPreference ?? 'auto';
    request.investigation = resolveInvestigation(preference, request, historical).execution;
    this.investigation.control?.setExecution(request.caseId, request.investigation);
  }

  private async execute(request: DiagnosticRequest): Promise<ClaudeWorkerResponse> {
    const options = this.investigation?.control?.options(request.caseId);
    if (options?.signal?.aborted) throw new InvestigationCancelled();
    const response = await this.worker.diagnose(request, options);
    if (options?.signal?.aborted && response.result.evidence.length === 0) throw new InvestigationCancelled();
    return response;
  }

  private cancelledReview(review: ReviewPresentationResult, result?: DiagnosticResult): ReviewPresentationResult {
    if (!result?.claims.some(claim => (claim.type === 'fact' || claim.type === 'inference') && claim.evidenceIds.length > 0)) throw new InvestigationCancelled();
    return { ...review, reply: '排查已停止。以下为已审核的初步判断，不能作为最终结论。\n\n' + review.reply, decision: 'partial', caseStatus: 'partial' };
  }
}

function validWorkerLeads(leads: HistoricalLead[]): boolean {
  if (leads.length > 3) return false;
  return leads.every((lead) => (
    lead.checks.length > 0 &&
    lead.checks.every((check) => (
      READ_ONLY_ACTIONS.has(check.action) &&
      check.target.length > 0 && check.target.length <= 500 &&
      check.expectedMatch.length > 0 && check.expectedMatch.length <= 500 &&
      check.expectedMismatch.length > 0 && check.expectedMismatch.length <= 500
    ))
  ));
}

function usableReviewedClaims(result?: DiagnosticResult): boolean {
  return Boolean(result?.claims.some(claim => (claim.type === 'fact' || claim.type === 'inference') && claim.evidenceIds.length > 0));
}

function workerCoverageEnvelopes(
  response: Awaited<ReturnType<DiagnosticWorker['diagnose']>>,
): CoverageEvidenceEnvelope[] {
  return (response.coverageEvidence ?? []).map((item) => ({
    ...item,
    freshness: item.kind === 'log'
      ? 'current_log_excerpt' as const
      : 'current_worker_run' as const,
  }));
}
