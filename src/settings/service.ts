import type { ModelProviderConfig, SuperHelperConfig } from '../config.js';
import { defaultConfig, inferModelContextWindowTokens, saveConfig } from '../config.js';
import type { SecretRef } from '../domain.js';
import { runModelSmokeTest } from '../model-smoke-test.js';
import { runEmbeddingSmokeTest, type EmbeddingProviderConfig } from '../providers/embedding/index.js';
import { runRerankSmokeTest, type RerankProviderConfig } from '../providers/rerank/index.js';
import { listPublicAgentConfigs } from '../runtime/agent-configs.js';

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

export interface EmbeddingSettingsInput {
  enabled?: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  dimensions?: number;
  distance?: string;
  batchSize?: number;
  timeoutMs?: number;
}

export interface RerankSettingsInput {
  enabled?: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  topN?: number;
}

export interface ClaudeSettingsInput {
  timeoutMs?: number;
  maxBudgetUsd?: number | string | null;
  sessionBusyMaxRetries?: number;
  sessionBusyRetryDelayMs?: number;
}

export interface PublicSettingsSecretReader {
  has(ref?: SecretRef): boolean;
}

export interface SettingsSecretStore extends PublicSettingsSecretReader {
  set(key: string, value: string): SecretRef;
}

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

export function updateModelSettings(input: {
  config: SuperHelperConfig;
  secrets: SettingsSecretStore;
  body: ModelSettingsInput;
}): unknown {
  const providerId = input.body.providerId?.trim() || 'default';
  const existing = input.config.models.providers[providerId];
  const provider = modelProviderFromInput(input.body, existing);
  applySubmittedSecret(provider, input.body, input.secrets, `providers.agent.${providerId}`);
  input.config.models.providers[providerId] = provider;
  input.config.agent.modelProvider = providerId;
  input.config.agent.useModelForPreflight = input.body.useModelForPreflight ?? true;
  saveConfig(input.config);
  return publicSettings(input.config, input.secrets);
}

export async function testModelSettings(input: {
  config: SuperHelperConfig;
  body: ModelSettingsInput;
}): Promise<{ status: 200 | 400; body: unknown }> {
  const providerId = input.body.providerId?.trim() || input.config.agent.modelProvider || 'default';
  const existing = input.config.models.providers[providerId];
  if (!existing && !input.body.baseUrl && !input.body.model) {
    return { status: 400, body: { ok: false, error: `model provider "${providerId}" not configured` } };
  }

  const provider = modelProviderFromInput(input.body, existing);
  const result = await runModelSmokeTest(provider);
  return { status: 200, body: { providerId, ...result } };
}

export function updateEmbeddingSettings(input: {
  config: SuperHelperConfig;
  secrets: SettingsSecretStore;
  body: EmbeddingSettingsInput;
}): unknown {
  input.config.embedding = embeddingProviderFromInput(input.body, embeddingConfig(input.config));
  applySubmittedSecret(input.config.embedding, input.body, input.secrets, 'providers.embedding');
  saveConfig(input.config);
  return publicSettings(input.config, input.secrets);
}

export async function testEmbeddingSettings(input: {
  config: SuperHelperConfig;
  body: EmbeddingSettingsInput;
}): Promise<unknown> {
  const embedding = embeddingProviderFromInput(input.body, embeddingConfig(input.config));
  return runEmbeddingSmokeTest({ config: embedding, force: input.body.enabled === true });
}

export function updateRerankSettings(input: {
  config: SuperHelperConfig;
  secrets: SettingsSecretStore;
  body: RerankSettingsInput;
}): unknown {
  input.config.rerank = rerankProviderFromInput(input.body, rerankConfig(input.config));
  applySubmittedSecret(input.config.rerank, input.body, input.secrets, 'providers.rerank');
  saveConfig(input.config);
  return publicSettings(input.config, input.secrets);
}

export async function testRerankSettings(input: {
  config: SuperHelperConfig;
  body: RerankSettingsInput;
}): Promise<unknown> {
  const rerank = rerankProviderFromInput(input.body, rerankConfig(input.config));
  return runRerankSmokeTest({ config: rerank, force: input.body.enabled === true });
}

export function updateClaudeSettings(input: {
  config: SuperHelperConfig;
  secrets: SettingsSecretStore;
  body: ClaudeSettingsInput;
}): unknown {
  if (input.body.timeoutMs !== undefined) {
    input.config.claude.timeoutMs = Math.max(0, Number(input.body.timeoutMs));
  }
  if ('maxBudgetUsd' in input.body) {
    const maxBudgetUsd = optionalPositiveNumber(input.body.maxBudgetUsd);
    if (maxBudgetUsd === undefined) {
      delete input.config.claude.maxBudgetUsd;
    } else {
      input.config.claude.maxBudgetUsd = Math.max(0.01, maxBudgetUsd);
    }
  }
  if (input.body.sessionBusyMaxRetries !== undefined) {
    input.config.claude.sessionBusyMaxRetries = Math.max(0, Number(input.body.sessionBusyMaxRetries));
  }
  if (input.body.sessionBusyRetryDelayMs !== undefined) {
    input.config.claude.sessionBusyRetryDelayMs = Math.max(0, Number(input.body.sessionBusyRetryDelayMs));
  }
  saveConfig(input.config);
  return publicSettings(input.config, input.secrets);
}

export function embeddingProviderFromInput(
  input: EmbeddingSettingsInput,
  existing: EmbeddingProviderConfig,
): EmbeddingProviderConfig {
  return {
    ...existing,
    enabled: input.enabled ?? existing.enabled,
    provider: input.provider?.trim() || existing.provider,
    model: input.model?.trim() || existing.model,
    baseUrl: input.baseUrl?.trim() || existing.baseUrl,
    endpoint: input.endpoint?.trim() || existing.endpoint,
    apiKeyEnv: input.apiKeyEnv?.trim() || existing.apiKeyEnv,
    apiKey: input.apiKey?.trim() || existing.apiKey,
    dimensions: positiveInteger(input.dimensions) ?? existing.dimensions,
    distance: input.distance?.trim() || existing.distance,
    batchSize: positiveInteger(input.batchSize) ?? existing.batchSize,
    timeoutMs: positiveInteger(input.timeoutMs) ?? existing.timeoutMs,
  };
}

export function rerankProviderFromInput(
  input: RerankSettingsInput,
  existing: RerankProviderConfig,
): RerankProviderConfig {
  return {
    ...existing,
    enabled: input.enabled ?? existing.enabled,
    provider: input.provider?.trim() || existing.provider,
    model: input.model?.trim() || existing.model,
    baseUrl: input.baseUrl?.trim() || existing.baseUrl,
    endpoint: input.endpoint?.trim() || existing.endpoint,
    apiKeyEnv: input.apiKeyEnv?.trim() || existing.apiKeyEnv,
    apiKey: input.apiKey?.trim() || existing.apiKey,
    timeoutMs: positiveInteger(input.timeoutMs) ?? existing.timeoutMs,
    topN: positiveInteger(input.topN) ?? existing.topN,
  };
}

export function modelProviderFromInput(input: ModelSettingsInput, existing?: ModelProviderConfig): ModelProviderConfig {
  const provider: ModelProviderConfig = {
    type: 'openai-compatible',
    baseUrl: input.baseUrl?.trim() || existing?.baseUrl || '',
    api: input.api ?? existing?.api ?? 'openai-completions',
    apiKeyEnv: input.apiKeyEnv?.trim() || existing?.apiKeyEnv,
    apiKeyRef: existing?.apiKeyRef,
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

function embeddingConfig(config: SuperHelperConfig): SuperHelperConfig['embedding'] {
  return { ...defaultConfig().embedding, ...config.embedding };
}

function rerankConfig(config: SuperHelperConfig): SuperHelperConfig['rerank'] {
  return { ...defaultConfig().rerank, ...config.rerank };
}

function applySubmittedSecret(
  provider: { apiKey?: string; apiKeyEnv?: string; apiKeyRef?: SecretRef },
  input: { apiKey?: string; apiKeyEnv?: string },
  secrets: SettingsSecretStore,
  key: string,
): void {
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    provider.apiKeyRef = secrets.set(key, apiKey);
    provider.apiKey = apiKey;
    return;
  }

  const apiKeyEnv = input.apiKeyEnv?.trim();
  if (apiKeyEnv) {
    provider.apiKeyRef = { source: 'env', name: apiKeyEnv };
    delete provider.apiKey;
  }
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

function hasConfiguredSecret(
  config: { apiKey?: string; apiKeyEnv?: string; apiKeyRef?: SecretRef },
  secrets?: PublicSettingsSecretReader,
): boolean {
  return Boolean(
    config.apiKey ||
      (config.apiKeyEnv && process.env[config.apiKeyEnv]) ||
      (config.apiKeyRef && secrets?.has(config.apiKeyRef)),
  );
}

function optionalPositiveNumber(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function positiveInteger(value?: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}
