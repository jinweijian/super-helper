import type {
  DiagnosticLogEvent,
  DiagnosticRequest,
  DiagnosticResult,
  LogSeverity,
  WorkerTrace,
} from '../../domain.js';
import type { StoredCase } from '../../sessions/file-memory-store.js';
import type { AgentIdentity } from './identities.js';

export interface EventRecorderWriter {
  record(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent;
  recordAgent(
    caseSession: StoredCase,
    agent: AgentIdentity,
    event: Omit<DiagnosticLogEvent, 'id' | 'createdAt' | 'agentId' | 'agentRole' | 'agentName'>,
  ): DiagnosticLogEvent;
}

export function evidenceIdsFromResult(result: DiagnosticResult): string[] {
  return Array.from(new Set([
    ...result.evidence.map((evidence) => evidence.id),
    ...result.claims.flatMap((claim) => claim.evidenceIds),
  ].filter(Boolean)));
}

export function evidenceIdsFromRequest(request: DiagnosticRequest): string[] {
  const knowledgeEvidence = request.context?.knowledge?.evidence?.map((item) => item.id) ?? [];
  const previousEvidence = request.context?.previousRuns?.flatMap((run) => run.evidence.map((item) => item.id)) ?? [];
  return Array.from(new Set([...knowledgeEvidence, ...previousEvidence].filter(Boolean)));
}

export function diagnosticRequestLogDetail(
  request: DiagnosticRequest,
  decision: string,
): Record<string, unknown> {
  return {
    decision,
    caseId: request.caseId,
    runId: request.runId,
    workspaceId: request.workspaceId,
    userGoal: request.userGoal,
    knownFacts: request.knownFacts,
    unknowns: request.unknowns,
    constraints: request.constraints,
    allowedMcpToolIds: request.allowedMcpToolIds,
    evidenceIds: evidenceIdsFromRequest(request),
    deepQuery: request.context?.deepQuery,
  };
}

export function rawOutputSeverity(trace: WorkerTrace): LogSeverity {
  if (trace.error || trace.exitCode) {
    return 'error';
  }
  if (trace.stderr || /"subtype":"error_|error_max_budget_usd|timed out|already in use/i.test(trace.stdout)) {
    return 'warn';
  }
  return 'ok';
}
