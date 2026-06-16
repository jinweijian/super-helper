import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../../config.js';
import { defaultConfig, saveConfig } from '../../config.js';
import type { SecretRef } from '../../domain.js';
import { runEmbeddingSmokeTest, runRerankSmokeTest } from '../../embedding/index.js';
import { runModelSmokeTest } from '../../model-smoke-test.js';
import { listPublicAgentConfigs } from '../../runtime/agent-configs.js';
import {
  embeddingProviderFromInput,
  type ClaudeSettingsInput,
  type EmbeddingSettingsInput,
  type ModelSettingsInput,
  type RerankSettingsInput,
  modelProviderFromInput,
  publicSettings,
  rerankProviderFromInput,
} from '../dto.js';
import { readJson, sendJson } from '../http-utils.js';

interface SettingsSecretStore {
  set(key: string, value: string): SecretRef;
  has(ref?: SecretRef): boolean;
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: SuperHelperConfig,
  secrets: SettingsSecretStore,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, {
      agent: config.agent,
      workspace: config.workspaces[0],
      claude: {
        enabled: config.claude.enabled,
        command: config.claude.command,
        tools: config.claude.allowedTools ?? config.claude.tools,
        timeoutMs: config.claude.timeoutMs,
      },
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    sendJson(res, 200, publicSettings(config, secrets));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/agents') {
    sendJson(res, 200, { agents: listPublicAgentConfigs() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/model') {
    const body = (await readJson(req)) as ModelSettingsInput;
    const providerId = body.providerId?.trim() || 'default';
    const existing = config.models.providers[providerId];
    const provider = modelProviderFromInput(body, existing);
    applySubmittedSecret(provider, body, secrets, `providers.agent.${providerId}`);
    config.models.providers[providerId] = provider;
    config.agent.modelProvider = providerId;
    config.agent.useModelForPreflight = body.useModelForPreflight ?? true;
    saveConfig(config);
    sendJson(res, 200, publicSettings(config, secrets));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/model/test') {
    const body = (await readJson(req)) as ModelSettingsInput;
    const providerId = body.providerId?.trim() || config.agent.modelProvider || 'default';
    const existing = config.models.providers[providerId];
    if (!existing && !body.baseUrl && !body.model) {
      sendJson(res, 400, { ok: false, error: `model provider "${providerId}" not configured` });
      return true;
    }

    const provider = modelProviderFromInput(body, existing);
    const result = await runModelSmokeTest(provider);
    sendJson(res, 200, { providerId, ...result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/embedding') {
    const body = (await readJson(req)) as EmbeddingSettingsInput;
    config.embedding = embeddingProviderFromInput(body, embeddingConfig(config));
    applySubmittedSecret(config.embedding, body, secrets, 'providers.embedding');
    saveConfig(config);
    sendJson(res, 200, publicSettings(config, secrets));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/embedding/test') {
    const body = (await readJson(req)) as EmbeddingSettingsInput;
    const embedding = embeddingProviderFromInput(body, embeddingConfig(config));
    const result = await runEmbeddingSmokeTest({ config: embedding, force: body.enabled === true });
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/rerank') {
    const body = (await readJson(req)) as RerankSettingsInput;
    config.rerank = rerankProviderFromInput(body, rerankConfig(config));
    applySubmittedSecret(config.rerank, body, secrets, 'providers.rerank');
    saveConfig(config);
    sendJson(res, 200, publicSettings(config, secrets));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/rerank/test') {
    const body = (await readJson(req)) as RerankSettingsInput;
    const rerank = rerankProviderFromInput(body, rerankConfig(config));
    const result = await runRerankSmokeTest({ config: rerank, force: body.enabled === true });
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/claude') {
    const body = (await readJson(req)) as ClaudeSettingsInput;
    if (body.timeoutMs !== undefined) {
      config.claude.timeoutMs = Math.max(0, Number(body.timeoutMs));
    }
    if ('maxBudgetUsd' in body) {
      const maxBudgetUsd = optionalPositiveNumber(body.maxBudgetUsd);
      if (maxBudgetUsd === undefined) {
        delete config.claude.maxBudgetUsd;
      } else {
        config.claude.maxBudgetUsd = Math.max(0.01, maxBudgetUsd);
      }
    }
    if (body.sessionBusyMaxRetries !== undefined) {
      config.claude.sessionBusyMaxRetries = Math.max(0, Number(body.sessionBusyMaxRetries));
    }
    if (body.sessionBusyRetryDelayMs !== undefined) {
      config.claude.sessionBusyRetryDelayMs = Math.max(0, Number(body.sessionBusyRetryDelayMs));
    }
    saveConfig(config);
    sendJson(res, 200, publicSettings(config, secrets));
    return true;
  }

  return false;
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

function optionalPositiveNumber(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}
