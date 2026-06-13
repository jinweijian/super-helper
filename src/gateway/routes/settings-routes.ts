import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../../config.js';
import { saveConfig } from '../../config.js';
import { createModelClient } from '../../model.js';
import { listPublicAgentConfigs } from '../../runtime/agent-configs.js';
import { type ClaudeSettingsInput, type ModelSettingsInput, modelProviderFromInput, publicSettings } from '../dto.js';
import { readJson, sendJson } from '../http-utils.js';

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: SuperHelperConfig,
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
    sendJson(res, 200, publicSettings(config));
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
    config.models.providers[providerId] = provider;
    config.agent.modelProvider = providerId;
    config.agent.useModelForPreflight = body.useModelForPreflight ?? true;
    saveConfig(config);
    sendJson(res, 200, publicSettings(config));
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
    try {
      const startedAt = Date.now();
      const reply = await createModelClient(provider).complete([
        {
          role: 'system',
          content: 'You are a connectivity test for super helper. Reply briefly.',
        },
        {
          role: 'user',
          content: 'super helper model connectivity test. Reply with "ok".',
        },
      ]);
      sendJson(res, 200, {
        ok: true,
        providerId,
        model: provider.model,
        durationMs: Date.now() - startedAt,
        reply,
      });
    } catch (error) {
      sendJson(res, 200, {
        ok: false,
        providerId,
        model: provider.model,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/claude') {
    const body = (await readJson(req)) as ClaudeSettingsInput;
    if (body.timeoutMs !== undefined) {
      config.claude.timeoutMs = Math.max(0, Number(body.timeoutMs));
    }
    if (body.maxBudgetUsd !== undefined) {
      config.claude.maxBudgetUsd = Math.max(0.01, Number(body.maxBudgetUsd));
    }
    if (body.sessionBusyMaxRetries !== undefined) {
      config.claude.sessionBusyMaxRetries = Math.max(0, Number(body.sessionBusyMaxRetries));
    }
    if (body.sessionBusyRetryDelayMs !== undefined) {
      config.claude.sessionBusyRetryDelayMs = Math.max(0, Number(body.sessionBusyRetryDelayMs));
    }
    saveConfig(config);
    sendJson(res, 200, publicSettings(config));
    return true;
  }

  return false;
}
