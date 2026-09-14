import type { DiagnosticRequest } from '../../domain.js';
import type { StoredCase } from '../../sessions/case-repository.js';
import type { ExperienceCollectionOutcome, ExperienceTurnService } from '../experience-turn.js';
import type { KnowledgeCollectionOutcome, KnowledgeTurnService } from '../knowledge-turn.js';
import type { RedmineBranch, RedmineBranchOutcome } from './redmine-branch.js';
import { failedRedmineBranch } from './redmine-branch.js';
import type { CaseRuntimeEventRecorder } from '../event-recorder.js';
import { throwIfInvestigationCancelled } from '../investigation-cancellation.js';

type FailedSource = { status: 'failed'; safeErrorCode: string };

export interface ParallelSourceOutcome {
  knowledge: KnowledgeCollectionOutcome | (FailedSource & { coverageEvidenceEnvelopes: [] }) | { status: 'skipped'; coverageEvidenceEnvelopes: [] };
  experience: ExperienceCollectionOutcome | (FailedSource & { rejectedCandidates: [] });
  redmine: RedmineBranchOutcome;
}

export class ParallelSourceCollector {
  constructor(private readonly sources: {
    knowledge?: Pick<KnowledgeTurnService, 'collect'>;
    experience: Pick<ExperienceTurnService, 'collect'>;
    redmine: Pick<RedmineBranch, 'collect'>;
    events?: Pick<CaseRuntimeEventRecorder,
      'historicalCaseSearchStarted' | 'historicalCaseSearchCompleted' |
      'historicalCaseAnalysisStarted' | 'historicalCaseAnalysisCompleted'>;
  }) {}

  async collect(caseSession: StoredCase, request: DiagnosticRequest, signal?: AbortSignal): Promise<ParallelSourceOutcome> {
    throwIfInvestigationCancelled(signal);
    const [knowledge, experience, redmine] = await Promise.allSettled([
      this.sources.knowledge
        ? this.sources.knowledge.collect(caseSession, request.userGoal, structuredClone(request), signal)
        : Promise.resolve({ status: 'skipped' as const, coverageEvidenceEnvelopes: [] as [] }),
      this.sources.experience.collect(caseSession, structuredClone(request)),
      this.sources.redmine.collect(structuredClone(request), {
        searchStarted: () => this.sources.events?.historicalCaseSearchStarted(caseSession, { runId: request.runId }),
        searchCompleted: (outcome, durationMs) => this.sources.events?.historicalCaseSearchCompleted(caseSession, {
          runId: request.runId, status: outcome.status, candidateCount: outcome.candidates.length,
          detailCount: outcome.details.length, evidenceIds: outcome.evidence.map((item) => item.id),
          durationMs, degraded: Boolean(outcome.planDegraded || outcome.rerankDegraded),
        }),
        analysisStarted: (detailCount) => this.sources.events?.historicalCaseAnalysisStarted(caseSession, { runId: request.runId, detailCount }),
        analysisCompleted: (outcome, durationMs) => this.sources.events?.historicalCaseAnalysisCompleted(caseSession, {
          runId: request.runId, status: outcome.status, leadCount: outcome.leads.length,
          leadIds: outcome.leads.map((item) => item.id), evidenceIds: outcome.evidence.map((item) => item.id),
          durationMs, degraded: Boolean(outcome.analysisDegraded),
        }),
      }, signal),
    ]);
    throwIfInvestigationCancelled(signal);
    return {
      knowledge: knowledge.status === 'fulfilled'
        ? knowledge.value
        : { status: 'failed', safeErrorCode: 'knowledge_failure', coverageEvidenceEnvelopes: [] },
      experience: experience.status === 'fulfilled'
        ? experience.value
        : { status: 'failed', safeErrorCode: 'experience_failure', rejectedCandidates: [] },
      redmine: redmine.status === 'fulfilled'
        ? redmine.value
        : failedRedmineBranch('redmine_branch_failure'),
    };
  }
}
