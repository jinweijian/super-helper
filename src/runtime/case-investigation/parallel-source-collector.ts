import type { DiagnosticRequest } from '../../domain.js';
import type { StoredCase } from '../../sessions/case-repository.js';
import type { ExperienceCollectionOutcome, ExperienceTurnService } from '../experience-turn.js';
import type { KnowledgeCollectionOutcome, KnowledgeTurnService } from '../knowledge-turn.js';
import type { RedmineBranch, RedmineBranchOutcome } from './redmine-branch.js';
import { failedRedmineBranch } from './redmine-branch.js';

type FailedSource = { status: 'failed'; safeErrorCode: string };

export interface ParallelSourceOutcome {
  knowledge: KnowledgeCollectionOutcome | (FailedSource & { coverageEvidenceEnvelopes: [] });
  experience: ExperienceCollectionOutcome | (FailedSource & { rejectedCandidates: [] });
  redmine: RedmineBranchOutcome;
}

export class ParallelSourceCollector {
  constructor(private readonly sources: {
    knowledge: Pick<KnowledgeTurnService, 'collect'>;
    experience: Pick<ExperienceTurnService, 'collect'>;
    redmine: Pick<RedmineBranch, 'collect'>;
  }) {}

  async collect(caseSession: StoredCase, request: DiagnosticRequest): Promise<ParallelSourceOutcome> {
    const [knowledge, experience, redmine] = await Promise.allSettled([
      this.sources.knowledge.collect(caseSession, request.userGoal, structuredClone(request)),
      this.sources.experience.collect(caseSession, structuredClone(request)),
      this.sources.redmine.collect(structuredClone(request)),
    ]);
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
