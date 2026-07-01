import type { ClaudeWorkerResponse, DiagnosticRequest, DiagnosticResult, DiagnosticRun } from '../domain.js';
import { sanitizeWorkerTrace } from '../observability/worker-trace.js';
import { nextDeepQueryPivot } from './query-correction.js';

export type WorkerTurnReviewDecision = 'ask_user' | 'dispatched' | 'final' | 'partial' | 'escalate';
type DeepQueryContext = NonNullable<NonNullable<DiagnosticRequest['context']>['deepQuery']>;

export function createRunningDiagnosticRun(input: {
  request: DiagnosticRequest;
  caseId: string;
}): DiagnosticRun {
  return {
    id: input.request.runId,
    caseId: input.caseId,
    status: 'running',
    request: input.request,
  };
}

export function applyWorkerResponseToRun(input: {
  run: DiagnosticRun;
  response: ClaudeWorkerResponse;
}): DiagnosticResult {
  input.run.status = input.response.result.status;
  input.run.result = input.response.result;
  input.run.workerTrace = sanitizeWorkerTrace(input.response.trace);
  return input.response.result;
}

export function prepareDeepQueryRetry(input: {
  previousRequest: DiagnosticRequest;
  previousResult: DiagnosticResult;
  workerTrace?: { error?: string; exitCode?: number };
  reviewDecision: WorkerTurnReviewDecision;
}): {
  retry?: { deepQuery: DeepQueryContext };
  stop?: {
    reason: string;
    attempt: number;
    maxAttempts?: number;
    previousArtifactTargets?: string[];
    nextArtifactTargets?: string[];
    failedReasons?: string[];
    correctionActions?: string[];
  };
} {
  const previousDeepQuery = input.previousRequest.context?.deepQuery;
  if (!previousDeepQuery) {
    return {};
  }

  const attempt = previousDeepQuery.attempt ?? 1;
  const maxAttempts = previousDeepQuery.maxAttempts ?? 2;
  const previousArtifactTargets = previousDeepQuery.artifactTargets ?? [];
  const failedReasons = Array.from(new Set([
    ...(previousDeepQuery.failedReasons ?? []),
    ...deriveDeepQueryFailedReasons(input.previousResult, input.workerTrace),
  ]));

  if (input.workerTrace?.error || input.workerTrace?.exitCode) {
    return {
      stop: {
        reason: 'worker_failure',
        attempt,
        maxAttempts,
        previousArtifactTargets,
        failedReasons,
      },
    };
  }

  if (input.reviewDecision === 'escalate') {
    return {
      stop: {
        reason: 'human_escalation',
        attempt,
        maxAttempts,
        previousArtifactTargets,
        failedReasons,
      },
    };
  }

  if (input.previousResult.recommendedNextAction === 'ask_user') {
    return {
      stop: {
        reason: 'needs_user',
        attempt,
        maxAttempts,
        previousArtifactTargets,
        failedReasons,
      },
    };
  }

  const judge = input.previousRequest.context?.knowledge?.judge as { answerable?: boolean; blockers?: string[] } | undefined;
  const pivot = nextDeepQueryPivot({
    previousArtifactTargets,
    workerResultSummary: input.previousResult.summary,
    judgeResult: judge
      ? {
          answerable: Boolean(judge.answerable),
          blockers: judge.blockers ?? [],
        }
      : undefined,
    attempt,
    maxAttempts,
  });

  if (pivot.stopReason) {
    return {
      stop: {
        reason: pivot.stopReason,
        attempt,
        maxAttempts,
        previousArtifactTargets,
        nextArtifactTargets: pivot.nextArtifactTargets,
        failedReasons,
        correctionActions: pivot.correctionActions,
      },
    };
  }

  if (sameStringSet(previousArtifactTargets, pivot.nextArtifactTargets)) {
    return {
      stop: {
        reason: 'no_new_pivot',
        attempt,
        maxAttempts,
        previousArtifactTargets,
        nextArtifactTargets: pivot.nextArtifactTargets,
        failedReasons,
        correctionActions: pivot.correctionActions,
      },
    };
  }

  const nextAttempt = attempt + 1;
  return {
    retry: {
      deepQuery: {
        ...previousDeepQuery,
        attempt: nextAttempt,
        maxAttempts,
        previousArtifactTargets,
        artifactTargets: pivot.nextArtifactTargets,
        correctionActions: pivot.correctionActions,
        failedReasons,
        triedQueries: Array.from(new Set([...(previousDeepQuery.triedQueries ?? []), input.previousRequest.userGoal])),
        nextPivot: pivot.nextArtifactTargets[0],
        stopReason: undefined,
      },
    },
  };
}

function deriveDeepQueryFailedReasons(result: DiagnosticResult, trace?: { error?: string }): string[] {
  const reasons: string[] = [];
  if (result.summary) {
    reasons.push(result.summary.slice(0, 160));
  }
  for (const item of result.missingInfo) {
    reasons.push(`missing:${item}`);
  }
  if (trace?.error) {
    reasons.push(`worker:${trace.error}`);
  }
  return reasons;
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}
