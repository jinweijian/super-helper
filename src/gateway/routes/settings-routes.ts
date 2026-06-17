import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../../config.js';
import {
  configSettings,
  type ClaudeSettingsInput,
  type EmbeddingSettingsInput,
  type ModelSettingsInput,
  type RerankSettingsInput,
  publicAgentSettings,
  publicSettings,
  type SettingsSecretStore,
  testEmbeddingSettings,
  testModelSettings,
  testRerankSettings,
  updateClaudeSettings,
  updateEmbeddingSettings,
  updateModelSettings,
  updateRerankSettings,
} from '../../settings/service.js';
import { readJson, sendJson } from '../http-utils.js';

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: SuperHelperConfig,
  secrets: SettingsSecretStore,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, configSettings(config));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    sendJson(res, 200, publicSettings(config, secrets));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/agents') {
    sendJson(res, 200, publicAgentSettings());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/model') {
    const body = (await readJson(req)) as ModelSettingsInput;
    sendJson(res, 200, updateModelSettings({ config, secrets, body }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/model/test') {
    const body = (await readJson(req)) as ModelSettingsInput;
    const result = await testModelSettings({ config, body });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/embedding') {
    const body = (await readJson(req)) as EmbeddingSettingsInput;
    sendJson(res, 200, updateEmbeddingSettings({ config, secrets, body }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/embedding/test') {
    const body = (await readJson(req)) as EmbeddingSettingsInput;
    sendJson(res, 200, await testEmbeddingSettings({ config, body }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/rerank') {
    const body = (await readJson(req)) as RerankSettingsInput;
    sendJson(res, 200, updateRerankSettings({ config, secrets, body }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/rerank/test') {
    const body = (await readJson(req)) as RerankSettingsInput;
    sendJson(res, 200, await testRerankSettings({ config, body }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/claude') {
    const body = (await readJson(req)) as ClaudeSettingsInput;
    sendJson(res, 200, updateClaudeSettings({ config, secrets, body }));
    return true;
  }

  return false;
}
