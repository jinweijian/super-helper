import { randomUUID } from 'node:crypto';
import type { AnswerGoal, DiagnosticRequest, DiagnosticResult, DiagnosticRun } from '../domain.js';
import type { FileMemoryStore, StoredCase } from '../sessions/file-memory-store.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { answerGoalText, primaryAnswerItems } from './answer-goal.js';
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
    const question = answerGoalText(request.answerGoal);
    this.events.experienceStarted(caseSession, question);
    const match = findExperienceMatch({
      store: this.store,
      currentCase: caseSession,
      userMessage: question,
    });

    if (!match) {
      const rejectedCandidates = findRejectedExperienceCandidates({
        store: this.store,
        currentCase: caseSession,
        userMessage: question,
      });
      if (rejectedCandidates.length > 0) {
        request.context ??= {
          isFollowUp: false,
          currentUserMessage: request.answerGoal.rawUserQuestion,
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
    const result = bindExperienceResultToCurrentGoal(match.result, request.answerGoal);
    const run: DiagnosticRun = {
      id: `run_${randomUUID().slice(0, 8)}`,
      caseId: caseSession.id,
      status: result.status,
      request,
      result,
    };
    this.store.addRun(caseSession, run);
    caseSession.status = caseStatusFromDiagnosticResult(result);
    this.store.saveCase(caseSession);
    const review = await this.reviewer.reviewAndFormat(caseSession, result, run);
    this.events.presentationPrepared(caseSession, review.decision);
    this.store.addMessage(caseSession, { role: 'helper', body: review.reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, review.reply, review.decision);
    return { caseSession, assistantMessage: review.reply, decision: review.decision };
  }
}

function bindExperienceResultToCurrentGoal(result: DiagnosticResult, answerGoal: AnswerGoal): DiagnosticResult {
  const answers = primaryAnswerItems(answerGoal);
  return {
    ...result,
    claims: result.claims.map((claim) => claim.role === 'primary_answer'
      ? { ...claim, answers }
      : claim),
  };
}
