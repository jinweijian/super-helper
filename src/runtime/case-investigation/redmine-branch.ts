import type { DiagnosticRequest, Evidence } from '../../domain.js';
import type { HistoricalCaseEvidenceOutcome, HistoricalCaseEvidenceService } from '../../mcp/historical-case-evidence-service.js';
import type { CoverageEvidenceEnvelope } from '../coverage-evidence-provenance.js';
import type { CandidateRerankerService } from './candidate-reranker-service.js';
import type { HistoricalLead } from './contracts.js';
import type { HistoricalCaseAnalyzerService } from './historical-case-analyzer-service.js';
import type { QueryPlannerService } from './query-planner-service.js';
import { throwIfInvestigationCancelled } from '../investigation-cancellation.js';

export interface RedmineBranchOutcome extends HistoricalCaseEvidenceOutcome {
  leads: HistoricalLead[];
  planDegraded?: boolean;
  rerankDegraded?: boolean;
  analysisDegraded?: boolean;
}

export interface RedmineBranchProgress {
  searchStarted(): void;
  searchCompleted(outcome: RedmineBranchOutcome, durationMs: number): void;
  analysisStarted(detailCount: number): void;
  analysisCompleted(outcome: RedmineBranchOutcome, durationMs: number): void;
}

export class RedmineBranch {
  constructor(private readonly services: {
    planner: Pick<QueryPlannerService, 'plan'>;
    evidence: Pick<HistoricalCaseEvidenceService, 'investigate'>;
    reranker: Pick<CandidateRerankerService, 'select'>;
    analyzer: Pick<HistoricalCaseAnalyzerService, 'analyze'>;
  }) {}

  async collect(request: DiagnosticRequest, progress?: RedmineBranchProgress, signal?: AbortSignal): Promise<RedmineBranchOutcome> {
    throwIfInvestigationCancelled(signal);
    const searchStartedAt = Date.now();
    progress?.searchStarted();
    const plan = await this.services.planner.plan({ answerGoal: request.answerGoal }, signal);
    throwIfInvestigationCancelled(signal);
    let rerankDegraded = false;
    const outcome = await this.services.evidence.investigate({
      request,
      query: plan.query,
      signals: plan.signals,
      selectIssueIds: async (candidates) => {
        throwIfInvestigationCancelled(signal);
        const selected = await this.services.reranker.select({ query: plan.query, candidates }, signal);
        throwIfInvestigationCancelled(signal);
        rerankDegraded = selected.degraded;
        return selected.issueIds;
      },
    });
    throwIfInvestigationCancelled(signal);
    if (outcome.status !== 'completed') {
      const result = { ...outcome, leads: [], planDegraded: plan.degraded, rerankDegraded };
      progress?.searchCompleted(result, Date.now() - searchStartedAt);
      return result;
    }
    const searched = { ...outcome, leads: [], planDegraded: plan.degraded, rerankDegraded };
    progress?.searchCompleted(searched, Date.now() - searchStartedAt);
    const analysisStartedAt = Date.now();
    progress?.analysisStarted(outcome.details.length);
    const analysis = await this.services.analyzer.analyze({
      details: outcome.details,
      evidence: outcome.evidence,
    }, signal);
    throwIfInvestigationCancelled(signal);
    const result = {
      ...outcome,
      leads: analysis.leads,
      planDegraded: plan.degraded,
      rerankDegraded,
      analysisDegraded: analysis.degraded,
    };
    progress?.analysisCompleted(result, Date.now() - analysisStartedAt);
    return result;
  }
}

export function failedRedmineBranch(safeErrorCode: string): RedmineBranchOutcome {
  return {
    status: safeErrorCode === 'timeout' ? 'timeout' : 'failed',
    candidates: [],
    details: [],
    evidence: [] as Evidence[],
    coverageEvidenceEnvelopes: [] as CoverageEvidenceEnvelope[],
    leads: [],
    safeErrorCode,
  };
}
