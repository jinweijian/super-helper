import type { ModelProviderConfig, SuperHelperConfig } from '../config.js';
import { inferModelContextWindowTokens, saveConfig } from '../config.js';
import { runModelSmokeTest } from '../providers/model/smoke-test.js';
import type { ModelSettingsInput, SettingsSecretStore } from './contracts.js';
import { publicSettings } from './public-view.js';
import { applySubmittedSecret } from './secrets.js';

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
  input.config.agent.useModelForEvidenceCoverage = input.body.useModelForEvidenceCoverage ?? true;
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

function positiveInteger(value?: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}
