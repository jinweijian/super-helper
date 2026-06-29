import { randomUUID } from 'node:crypto';
import type { DiagnosticRequest, DiagnosticRun } from '../domain.js';
import type { FileMemoryStore, StoredCase } from '../sessions/file-memory-store.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { findExperienceMatch, findRejectedExperienceCandidates } from './experience-agent.js';
import { caseStatusFromDiagnosticResult } from './review-gate.js';
import { ReviewPresentationService } from './review-presentation.js';

export class ExperienceTurnService {
  constructor(
    private readonly store: FileMemoryStore,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly reviewer: ReviewPresentationService,
  ) {}

  async answer(
    caseSession: StoredCase,
    request: DiagnosticRequest,
    replyToMessageId?: string,
  ): Promise<RuntimeTurnResponse | undefined> {
    this.events.experienceStarted(caseSession, request.userGoal);
    const match = findExperienceMatch({
      store: this.store,
      currentCase: caseSession,
      userMessage: request.userGoal,
      answerContract: request.context?.answerContract,
    });

    if (!match) {
      const rejectedCandidates = findRejectedExperienceCandidates({
        store: this.store,
        currentCase: caseSession,
        userMessage: request.userGoal,
        answerContract: request.context?.answerContract,
      });
      if (rejectedCandidates.length > 0) {
        request.context ??= {
          isFollowUp: false,
          currentUserMessage: request.userGoal,
          recentMessages: [],
          previousRuns: [],
        };
        request.context.experienceCandidates = rejectedCandidates;
        this.events.experienceCandidatesRejected(caseSession, rejectedCandidates);
      }
      this.events.experienceMiss(caseSession);
      return undefined;
    }

    this.events.experienceHit(caseSession, {
      sourceCaseId: match.sourceCaseId,
      sourceMessageId: match.sourceMessageId,
      sourceReplyId: match.sourceReplyId,
      sourceRunId: match.sourceRunId,
      score: match.score,
    });
    const run: DiagnosticRun = {
      id: `run_${randomUUID().slice(0, 8)}`,
      caseId: caseSession.id,
      status: match.result.status,
      request,
      result: match.result,
    };
    this.store.addRun(caseSession, run);
    caseSession.status = caseStatusFromDiagnosticResult(match.result);
    this.store.saveCase(caseSession);
    const review = await this.reviewer.reviewAndFormat(caseSession, match.result, run);
    this.events.presentationPrepared(caseSession, review.decision);
    this.store.addMessage(caseSession, { role: 'helper', body: review.reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, review.reply, review.decision);
    return { caseSession, assistantMessage: review.reply, decision: review.decision };
  }
}
