import type { ModelProviderConfig, SuperHelperConfig } from '../config.js';
import { inferModelContextWindowTokens, resolveContextWindowTokens } from '../config.js';
import { estimateCaseContextUsage } from '../context-window.js';
import type { UserPersona } from '../domain.js';
import { buildKnowledgeHealthSummary, type KnowledgeHealthSummary } from '../knowledge/index.js';
import type { StoredCase } from '../storage.js';

export interface ModelSettingsInput {
  providerId?: string;
  type?: 'openai-compatible';
  baseUrl?: string;
  api?: 'openai-completions' | 'openai-chat-completions';
  apiKey?: string;
  apiKeyEnv?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindowTokens?: number;
  useModelForPreflight?: boolean;
}

export interface ClaudeSettingsInput {
  timeoutMs?: number;
  maxBudgetUsd?: number | string | null;
  sessionBusyMaxRetries?: number;
  sessionBusyRetryDelayMs?: number;
}

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

export function publicSettings(config: SuperHelperConfig): unknown {
  return {
    agent: config.agent,
    models: {
      providers: Object.fromEntries(
        Object.entries(config.models.providers).map(([id, provider]) => [
          id,
          {
            type: provider.type,
            baseUrl: provider.baseUrl,
            api: provider.api,
            apiKeyEnv: provider.apiKeyEnv,
            hasApiKey: Boolean(provider.apiKey || (provider.apiKeyEnv && process.env[provider.apiKeyEnv])),
            model: provider.model,
            temperature: provider.temperature,
            maxTokens: provider.maxTokens,
            contextWindowTokens: provider.contextWindowTokens ?? inferModelContextWindowTokens(provider.model),
          },
        ]),
      ),
    },
    claude: {
      enabled: config.claude.enabled,
      command: config.claude.command,
      permissionMode: config.claude.permissionMode,
      commandWhitelist: config.claude.commandWhitelist,
      tools: config.claude.tools,
      allowedTools: config.claude.allowedTools,
      disallowedTools: config.claude.disallowedTools,
      timeoutMs: config.claude.timeoutMs,
      maxBudgetUsd: config.claude.maxBudgetUsd,
      sessionBusyMaxRetries: config.claude.sessionBusyMaxRetries,
      sessionBusyRetryDelayMs: config.claude.sessionBusyRetryDelayMs,
    },
  };
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

export function serializeSession(
  caseSession: StoredCase,
  config: SuperHelperConfig,
): SessionSummary & Pick<StoredCase, 'messages' | 'runs'> & { knowledgeHealth: KnowledgeHealthSummary } {
  return {
    ...sessionSummary(caseSession, config),
    messages: caseSession.messages,
    runs: caseSession.runs,
    knowledgeHealth: buildKnowledgeHealthSummary({
      config,
      workspaceId: caseSession.workspaceId,
      query: knowledgeHealthQuery(caseSession),
    }),
  };
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

export function modelProviderFromInput(input: ModelSettingsInput, existing?: ModelProviderConfig): ModelProviderConfig {
  const provider: ModelProviderConfig = {
    type: 'openai-compatible',
    baseUrl: input.baseUrl?.trim() || existing?.baseUrl || '',
    api: input.api ?? existing?.api ?? 'openai-completions',
    apiKeyEnv: input.apiKeyEnv?.trim() || existing?.apiKeyEnv,
    apiKey: input.apiKey?.trim() || existing?.apiKey,
    model: input.model?.trim() || existing?.model || '',
    temperature: input.temperature ?? existing?.temperature ?? 0,
    maxTokens: input.maxTokens ?? existing?.maxTokens ?? 1200,
    contextWindowTokens:
      positiveInteger(input.contextWindowTokens) ??
      positiveInteger(existing?.contextWindowTokens) ??
      inferModelContextWindowTokens(input.model?.trim() || existing?.model),
  };

  if (!provider.baseUrl) {
    throw new Error('baseUrl is required');
  }
  if (!provider.model) {
    throw new Error('model is required');
  }

  return provider;
}

function positiveInteger(value?: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}

function knowledgeHealthQuery(caseSession: StoredCase): string {
  return [...caseSession.messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.body
    .trim() || caseSession.title;
}
