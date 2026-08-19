import type { DiagnosticRequest, Evidence } from '../../domain.js';
import type { HistoricalCaseEvidenceOutcome, HistoricalCaseEvidenceService } from '../../mcp/historical-case-evidence-service.js';
import type { CoverageEvidenceEnvelope } from '../coverage-evidence-provenance.js';
import type { CandidateRerankerService } from './candidate-reranker-service.js';
import type { HistoricalLead } from './contracts.js';
import type { HistoricalCaseAnalyzerService } from './historical-case-analyzer-service.js';
import type { QueryPlannerService } from './query-planner-service.js';

export interface RedmineBranchOutcome extends HistoricalCaseEvidenceOutcome {
  leads: HistoricalLead[];
  planDegraded?: boolean;
  rerankDegraded?: boolean;
  analysisDegraded?: boolean;
}

export class RedmineBranch {
  constructor(private readonly services: {
    planner: Pick<QueryPlannerService, 'plan'>;
    evidence: Pick<HistoricalCaseEvidenceService, 'investigate'>;
    reranker: Pick<CandidateRerankerService, 'select'>;
    analyzer: Pick<HistoricalCaseAnalyzerService, 'analyze'>;
  }) {}

  async collect(request: DiagnosticRequest): Promise<RedmineBranchOutcome> {
    const plan = await this.services.planner.plan({ answerGoal: request.answerGoal });
    let rerankDegraded = false;
    const outcome = await this.services.evidence.investigate({
      request,
      query: plan.query,
      signals: plan.signals,
      selectIssueIds: async (candidates) => {
        const selected = await this.services.reranker.select({ query: plan.query, candidates });
        rerankDegraded = selected.degraded;
        return selected.issueIds;
      },
    });
    if (outcome.status !== 'completed') {
      return { ...outcome, leads: [], planDegraded: plan.degraded, rerankDegraded };
    }
    const analysis = await this.services.analyzer.analyze({
      details: outcome.details,
      evidence: outcome.evidence,
    });
    return {
      ...outcome,
      leads: analysis.leads,
      planDegraded: plan.degraded,
      rerankDegraded,
      analysisDegraded: analysis.degraded,
    };
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
