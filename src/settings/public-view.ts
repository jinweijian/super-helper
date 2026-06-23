import type { SuperHelperConfig } from '../config.js';
import { defaultConfig, inferModelContextWindowTokens } from '../config.js';
import type { EmbeddingProviderConfig } from '../providers/embedding/index.js';
import type { RerankProviderConfig } from '../providers/rerank/index.js';
import { listPublicAgentConfigs } from '../runtime/agent-configs.js';
import type { PublicSettingsSecretReader } from './contracts.js';
import { hasConfiguredSecret } from './secrets.js';

export function configSettings(config: SuperHelperConfig): unknown {
  return {
    agent: config.agent,
    workspace: config.workspaces[0],
    claude: {
      enabled: config.claude.enabled,
      command: config.claude.command,
      tools: config.claude.allowedTools ?? config.claude.tools,
      timeoutMs: config.claude.timeoutMs,
    },
  };
}

export function publicSettings(config: SuperHelperConfig, secrets?: PublicSettingsSecretReader): unknown {
  const defaults = defaultConfig();
  const embedding = { ...defaults.embedding, ...config.embedding };
  const rerank = { ...defaults.rerank, ...config.rerank };
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
            hasApiKey: hasConfiguredSecret(provider, secrets),
            model: provider.model,
            temperature: provider.temperature,
            maxTokens: provider.maxTokens,
            contextWindowTokens: provider.contextWindowTokens ?? inferModelContextWindowTokens(provider.model),
          },
        ]),
      ),
    },
    embedding: publicEmbeddingSettings(embedding, secrets),
    rerank: publicRerankSettings(rerank, secrets),
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

export function publicAgentSettings(): unknown {
  return { agents: listPublicAgentConfigs() };
}

function publicEmbeddingSettings(
  config: EmbeddingProviderConfig,
  secrets?: PublicSettingsSecretReader,
): Record<string, unknown> {
  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    endpoint: config.endpoint,
    apiKeyEnv: config.apiKeyEnv,
    hasApiKey: hasConfiguredSecret(config, secrets),
    dimensions: config.dimensions,
    distance: config.distance,
    batchSize: config.batchSize,
    timeoutMs: config.timeoutMs,
  };
}

function publicRerankSettings(
  config: RerankProviderConfig,
  secrets?: PublicSettingsSecretReader,
): Record<string, unknown> {
  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    endpoint: config.endpoint,
    apiKeyEnv: config.apiKeyEnv,
    hasApiKey: hasConfiguredSecret(config, secrets),
    timeoutMs: config.timeoutMs,
    topN: config.topN,
  };
}
