import type { SuperHelperConfig } from '../config.js';
import { resolveContextWindowTokens } from '../config.js';
import { estimateCaseContextUsage } from '../context-window.js';
import type { UserPersona } from '../domain.js';
import type { KnowledgeHealthSummary } from '../knowledge/health.js';
import { caseStatusFromDiagnosticResult } from '../runtime/review-gate.js';
import type { StoredCase } from '../sessions/case-repository.js';
import { sanitizeWorkerTrace } from '../observability/worker-trace.js';
import { findRetryableInterruption } from '../sessions/stale-turn.js';

export type {
  ClaudeSettingsInput,
  EmbeddingSettingsInput,
  ModelSettingsInput,
  PublicSettingsSecretReader,
  RerankSettingsInput,
  SettingsSecretStore,
} from '../settings/service.js';
export {
  embeddingProviderFromInput,
  modelProviderFromInput,
  publicSettings,
  rerankProviderFromInput,
} from '../settings/service.js';

export interface SessionSummary {
  id: string;
  claudeSessionId: string;
  title: string;
  status: StoredCase['status'];
  workspaceId: string;
  userPersona: UserPersona;
  messageCount: number;
  runCount: number;
  lastMessage: string;
  createdAt: string;
  updatedAt: string;
  pinnedAt?: string;
  archivedAt?: string;
  contextUsage?: ReturnType<typeof estimateCaseContextUsage>;
  agentActivity?: AgentActivityItem[];
}

export interface AgentActivityItem {
  id: string;
  createdAt: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  phase: string;
  label: string;
  summary: string;
  severity: string;
}

export interface RetryableTurnDto {
  userMessageId: string;
  interruptedAt: string;
  reason: 'service_restarted' | 'user_cancelled';
}

export type SerializedSession = SessionSummary
  & Pick<StoredCase, 'messages' | 'runs'>
  & { knowledgeHealth?: KnowledgeHealthSummary; retryableTurn?: RetryableTurnDto };

export interface SerializeSessionOptions {
  knowledgeHealth?: KnowledgeHealthSummary;
}

export function sessionSummary(caseSession: StoredCase, config?: SuperHelperConfig): SessionSummary {
  const lastMessage = caseSession.messages.at(-1);
  return {
    id: caseSession.id,
    claudeSessionId: caseSession.claudeSessionId,
    title: caseSession.title,
    status: publicSessionStatus(caseSession),
    workspaceId: caseSession.workspaceId,
    userPersona: caseSession.userPersona,
    messageCount: caseSession.messages.length,
    runCount: caseSession.runs.length,
    lastMessage: lastMessage?.body ?? '',
    createdAt: caseSession.createdAt,
    updatedAt: caseSession.updatedAt,
    pinnedAt: caseSession.pinnedAt,
    archivedAt: caseSession.archivedAt,
    contextUsage: config ? estimateCaseContextUsage(caseSession, resolveContextWindowTokens(config)) : undefined,
    agentActivity: recentAgentActivity(caseSession),
  };
}

const ACTIVE_CASE_STATUSES: StoredCase['status'][] = [
  'ready_for_diagnosis',
  'diagnosing',
];

function publicSessionStatus(caseSession: StoredCase): StoredCase['status'] {
  if (ACTIVE_CASE_STATUSES.includes(caseSession.status)) {
    return caseSession.status;
  }
  const latestResult = [...caseSession.runs].reverse().find((run) => run.result)?.result;
  return latestResult ? caseStatusFromDiagnosticResult(latestResult) : caseSession.status;
}

export function serializeSession(
  caseSession: StoredCase,
  config: SuperHelperConfig,
  options: SerializeSessionOptions = {},
): SerializedSession {
  const session: SerializedSession = {
    ...sessionSummary(caseSession, config),
    messages: caseSession.messages,
    runs: caseSession.runs.map((run) => ({
      ...run,
      workerTrace: run.workerTrace ? sanitizeWorkerTrace(run.workerTrace) : undefined,
    })),
  };
  if (options.knowledgeHealth) {
    session.knowledgeHealth = options.knowledgeHealth;
  }
  const interruption = findRetryableInterruption(caseSession);
  if (interruption) {
    const interruptedLog = [...caseSession.logs].reverse().find(
      (log) => log.phase === 'turn_interrupted' && (log.detail as Record<string, unknown> | undefined)?.userMessageId === interruption.userMessageId,
    );
    session.retryableTurn = {
      userMessageId: interruption.userMessageId,
      interruptedAt: interruptedLog?.createdAt ?? caseSession.updatedAt,
      reason: (interruptedLog?.detail as Record<string, unknown> | undefined)?.reason === 'user_cancelled' ? 'user_cancelled' : 'service_restarted',
    };
  }
  return session;
}

function recentAgentActivity(caseSession: StoredCase): AgentActivityItem[] {
  return (caseSession.logs ?? [])
    .filter((event) => (
      (event.actor === 'agent' && Boolean(event.agentId)) ||
      /^(historical_case_search|current_project_verification)_/.test(event.phase)
    ))
    .slice(-8)
    .reverse()
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      agentId: event.agentId ?? (event.actor === 'mcp' ? 'redmine-mcp' : 'claude-worker'),
      agentName: event.agentName ?? (event.actor === 'mcp' ? 'Redmine 工单源' : 'Claude Code Worker'),
      agentRole: event.agentRole ?? (event.actor === 'mcp' ? 'historical-case-source' : 'current-project-verification'),
      phase: event.phase,
      label: event.label ?? event.phase,
      summary: event.summary,
      severity: event.severity ?? 'info',
    }));
}
