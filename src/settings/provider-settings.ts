import type { SuperHelperConfig } from '../config.js';
import { defaultConfig, saveConfig } from '../config.js';
import { runEmbeddingSmokeTest, type EmbeddingProviderConfig } from '../providers/embedding/index.js';
import { runRerankSmokeTest, type RerankProviderConfig } from '../providers/rerank/index.js';
import type { EmbeddingSettingsInput, RerankSettingsInput, SettingsSecretStore } from './contracts.js';
import { publicSettings } from './public-view.js';
import { applySubmittedSecret } from './secrets.js';

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

function embeddingConfig(config: SuperHelperConfig): SuperHelperConfig['embedding'] {
  return { ...defaultConfig().embedding, ...config.embedding };
}

function rerankConfig(config: SuperHelperConfig): SuperHelperConfig['rerank'] {
  return { ...defaultConfig().rerank, ...config.rerank };
}

function positiveInteger(value?: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}
