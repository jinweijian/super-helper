import { randomUUID } from 'node:crypto';
import type { DiagnosticRequest, DiagnosticRun } from '../domain.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import {
  findExperienceMatch,
  findRejectedExperienceCandidates,
  type ExperienceMatch,
  type ExperienceCurrentEvidenceResolver,
  type RejectedExperienceCandidate,
} from './experience-agent.js';
import { ReviewPresentationService } from './review-presentation.js';
import { completePresentedTurn } from './turn-completion.js';

export interface ExperienceCollectionOutcome {
  status: 'completed' | 'no_hit';
  match?: ExperienceMatch;
  rejectedCandidates: RejectedExperienceCandidate[];
}

export class ExperienceTurnService {
  constructor(
    private readonly store: CaseRepository,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
    private readonly currentEvidenceResolver?: ExperienceCurrentEvidenceResolver,
  ) {}

  async collect(
    caseSession: StoredCase,
    request: DiagnosticRequest,
  ): Promise<ExperienceCollectionOutcome> {
    this.events.experienceStarted(caseSession, request.userGoal);
    const match = findExperienceMatch({
      store: this.store,
      currentCase: caseSession,
      userMessage: request.userGoal,
      answerGoal: request.answerGoal,
      currentEvidenceResolver: this.currentEvidenceResolver,
    });
    if (match) {
      this.events.experienceHit(caseSession, {
        sourceCaseId: match.sourceCaseId,
        sourceMessageId: match.sourceMessageId,
        sourceReplyId: match.sourceReplyId,
        sourceRunId: match.sourceRunId,
        score: match.score,
      });
      return { status: 'completed', match, rejectedCandidates: [] };
    }
    const rejectedCandidates = findRejectedExperienceCandidates({
      store: this.store,
      currentCase: caseSession,
      userMessage: request.userGoal,
      answerGoal: request.answerGoal,
      currentEvidenceResolver: this.currentEvidenceResolver,
    });
    if (rejectedCandidates.length > 0) {
      this.events.experienceCandidatesRejected(caseSession, rejectedCandidates);
    }
    this.events.experienceMiss(caseSession);
    return { status: 'no_hit', rejectedCandidates };
  }

  async answer(
    caseSession: StoredCase,
    request: DiagnosticRequest,
    replyToMessageId?: string,
    signal?: AbortSignal,
  ): Promise<RuntimeTurnResponse | undefined> {
    const collected = await this.collect(caseSession, request);
    const match = collected.match;
    if (!match) {
      const { rejectedCandidates } = collected;
      if (rejectedCandidates.length > 0) {
        request.context ??= {
          isFollowUp: false,
          currentUserMessage: request.userGoal,
          recentMessages: [],
          previousRuns: [],
        };
        request.context.experienceCandidates = rejectedCandidates;
      }
      return undefined;
    }
    const run: DiagnosticRun = {
      id: `run_${randomUUID().slice(0, 8)}`,
      caseId: caseSession.id,
      status: 'running',
      request,
      result: match.result,
    };
    caseSession.status = 'diagnosing';
    this.store.addRun(caseSession, run);
    const review = await this.reviewer.reviewAndFormat(caseSession, match.result, run, {
      signal,
      coverageEvidenceEnvelopes: match.coverageEvidenceEnvelopes,
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
