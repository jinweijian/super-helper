import type { SuperHelperConfig } from '../config.js';
import { resolveContextWindowTokens } from '../config.js';
import { estimateCaseContextUsage } from '../context-window.js';
import type { UserPersona } from '../domain.js';
import { getKnowledgeHealthSummary, type KnowledgeHealthSummary } from '../knowledge/health-service.js';
import type { StoredCase } from '../sessions/file-memory-store.js';
import { sanitizeWorkerTrace } from '../observability/worker-trace.js';

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

export type SerializedSession = SessionSummary
  & Pick<StoredCase, 'messages' | 'runs'>
  & { knowledgeHealth?: KnowledgeHealthSummary };

export interface SerializeSessionOptions {
  includeKnowledgeHealth?: boolean;
}

export function sessionSummary(caseSession: StoredCase, config?: SuperHelperConfig): SessionSummary {
  const lastMessage = caseSession.messages.at(-1);
  return {
    id: caseSession.id,
    claudeSessionId: caseSession.claudeSessionId,
    title: caseSession.title,
    status: caseSession.status,
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

export async function serializeSession(
  caseSession: StoredCase,
  config: SuperHelperConfig,
  options: SerializeSessionOptions = {},
): Promise<SerializedSession> {
  const session: SerializedSession = {
    ...sessionSummary(caseSession, config),
    messages: caseSession.messages,
    runs: caseSession.runs.map((run) => ({
      ...run,
      workerTrace: run.workerTrace ? sanitizeWorkerTrace(run.workerTrace) : undefined,
    })),
  };
  if (options.includeKnowledgeHealth !== false) {
    session.knowledgeHealth = await getKnowledgeHealthSummary({
      config,
      workspaceId: caseSession.workspaceId,
      query: knowledgeHealthQuery(caseSession),
    });
  }
  return session;
}

function recentAgentActivity(caseSession: StoredCase): AgentActivityItem[] {
  return (caseSession.logs ?? [])
    .filter((event) => event.actor === 'agent' && Boolean(event.agentId))
    .slice(-8)
    .reverse()
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      agentId: event.agentId ?? 'agent',
      agentName: event.agentName ?? event.agentId ?? 'Agent',
      agentRole: event.agentRole ?? 'agent',
      phase: event.phase,
      label: event.label ?? event.phase,
      summary: event.summary,
      severity: event.severity ?? 'info',
    }));
}

function knowledgeHealthQuery(caseSession: StoredCase): string {
  return [...caseSession.messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.body
    .trim() || caseSession.title;
}
