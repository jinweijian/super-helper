import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeJsonAtomic } from '../onboarding/atomic-json.js';
import type { SuperHelperConfig } from './contracts.js';
import { DEFAULT_HOME, defaultConfig } from './defaults.js';
import { selectActiveModelProvider } from './resolution.js';

export function configPath(homeDir = DEFAULT_HOME): string {
  return join(homeDir, 'config.json');
}

export function ensureConfig(homeDir = DEFAULT_HOME): SuperHelperConfig {
  const path = configPath(homeDir);
  if (!existsSync(path)) {
    const config = defaultConfig();
    config.storage.rootDir = homeDir;
    config.knowledge.rootDir = join(homeDir, 'knowledge');
    saveConfig(config, path);
    return config;
  }

  const config = loadConfig(path);
  saveConfig(config);
  return config;
}

export function loadConfig(path = configPath()): SuperHelperConfig {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<SuperHelperConfig>;
  const defaults = defaultConfig();
  const merged: SuperHelperConfig = {
    ...defaults,
    ...parsed,
    server: { ...defaults.server, ...parsed.server },
    storage: { ...defaults.storage, ...parsed.storage },
    knowledge: { ...defaults.knowledge, ...parsed.knowledge },
    agent: { ...defaults.agent, ...parsed.agent },
    models: { ...defaults.models, ...parsed.models },
    embedding: { ...defaults.embedding, ...parsed.embedding },
    rerank: { ...defaults.rerank, ...parsed.rerank },
    claude: { ...defaults.claude, ...parsed.claude },
    workspaces: parsed.workspaces?.length ? parsed.workspaces : defaults.workspaces,
    mcpTools: parsed.mcpTools ?? defaults.mcpTools,
    onboarding: { ...defaults.onboarding, ...parsed.onboarding },
  };
  merged.storage.rootDir = resolve(merged.storage.rootDir || DEFAULT_HOME);
  merged.knowledge.rootDir = resolve(parsed.knowledge?.rootDir || join(merged.storage.rootDir, 'knowledge'));
  merged.agent.modelProvider = selectActiveModelProvider(merged);
  merged.agent.useModelForRagAnswerability =
    parsed.agent?.useModelForRagAnswerability ??
    parsed.agent?.useModelForEvidenceCoverage ??
    merged.agent.useModelForRagAnswerability ??
    true;
  merged.agent.useModelForEvidenceCoverage = merged.agent.useModelForRagAnswerability;
  merged.agent.ragAnswerabilityTopN =
    parsed.agent?.ragAnswerabilityTopN ??
    parsed.agent?.evidenceCoverageTopN ??
    merged.agent.ragAnswerabilityTopN ??
    3;
  merged.agent.evidenceCoverageTopN = merged.agent.ragAnswerabilityTopN;
  // 0.2 used to be the implicit default. Treat that legacy value as unset.
  if (parsed.claude?.maxBudgetUsd === 0.2) {
    delete merged.claude.maxBudgetUsd;
  }
  validateHistoricalCaseSources(merged);
  return merged;
}

const REQUIRED_HISTORICAL_CASE_TOOLS = [
  'redmine_search_issues',
  'redmine_get_issue_case_details',
] as const;

function validateHistoricalCaseSources(config: SuperHelperConfig): void {
  for (const workspace of config.workspaces) {
    const sources = workspace.historicalCaseSources ?? [];
    if (sources.length > 1) {
      throw new Error(`workspace ${workspace.id} supports exactly one historical case source`);
    }
    for (const source of sources) {
      const sourceRecord = source as unknown as Record<string, unknown>;
      const unsupportedFields = Object.keys(sourceRecord).filter((key) => key !== 'serverId');
      if (unsupportedFields.length > 0) {
        throw new Error(`historical case source contains unsupported fields: ${unsupportedFields.sort().join(', ')}`);
      }
      if (typeof sourceRecord.serverId !== 'string' || sourceRecord.serverId.trim().length === 0) {
        throw new Error('historical case source serverId must be a non-empty string');
      }
      const serverId = sourceRecord.serverId;
      const server = config.mcpTools.find((item) => item.id === serverId);
      if (!server) throw new Error(`historical case server not found: ${serverId}`);
      if (!server.enabled) throw new Error(`historical case server must be enabled: ${serverId}`);
      if (server.permission !== 'read_only') {
        throw new Error(`historical case server must be read_only: ${serverId}`);
      }
      if (!workspace.mcpToolIds.includes(serverId)) {
        throw new Error(`historical case server not enabled for workspace: ${serverId}`);
      }
      if (server.capability?.type !== 'historical_case' || server.capability.provider !== 'redmine') {
        throw new Error(`historical case capability must be historical_case/redmine: ${serverId}`);
      }
      if (!REQUIRED_HISTORICAL_CASE_TOOLS.every((name) => server.allowedToolNames?.includes(name))) {
        throw new Error(`historical case tools not allowlisted: ${serverId}`);
      }
    }
  }
}

export function saveConfig(config: SuperHelperConfig, path = configPath(config.storage.rootDir)): void {
  writeJsonAtomic(path, configForPersistence(config));
}

export function configForPersistence(config: SuperHelperConfig): SuperHelperConfig {
  const copy = structuredClone(config);
  for (const provider of Object.values(copy.models?.providers ?? {})) {
    if (provider.apiKeyRef) {
      delete provider.apiKey;
    }
  }
  if (copy.embedding?.apiKeyRef) {
    delete copy.embedding.apiKey;
  }
  if (copy.rerank?.apiKeyRef) {
    delete copy.rerank.apiKey;
  }
  return copy;
}
