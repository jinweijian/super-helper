import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SecretRef, UserPersona } from './domain.js';
import type { EmbeddingProviderConfig } from './providers/embedding/contract.js';
import type { RerankProviderConfig } from './providers/rerank/contract.js';
import { writeJsonAtomic } from './onboarding/atomic-json.js';

export interface ModelProviderConfig {
  type: 'openai-compatible';
  baseUrl: string;
  api?: 'openai-completions' | 'openai-chat-completions';
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyRef?: SecretRef;
  model: string;
  temperature?: number;
  maxTokens?: number;
  contextWindowTokens?: number;
  timeoutMs?: number;
}

export interface SuperHelperConfig {
  version: 1;
  server: {
    host: string;
    port: number;
    bindMode: 'loopback' | 'lan';
  };
  storage: {
    rootDir: string;
    isolateByWorkspace: boolean;
  };
  knowledge: {
    rootDir: string;
    isolateByWorkspace: boolean;
    sourceDir?: string;
    buildVectorIndex: boolean;
  };
  agent: {
    name: string;
    language: 'zh-CN' | 'en-US';
    tone: 'calm_professional' | 'concise' | 'technical';
    modelProvider?: string;
    useModelForPreflight: boolean;
    defaultUserPersona: UserPersona;
    contextWindowTokens: number;
  };
  models: {
    providers: Record<string, ModelProviderConfig>;
  };
  embedding: EmbeddingProviderConfig;
  rerank: RerankProviderConfig;
  claude: {
    enabled: boolean;
    command: string;
    commandWhitelist: string[];
    permissionMode: 'plan' | 'dontAsk' | 'default';
    tools: string[];
    allowedTools: string[];
    disallowedTools: string[];
    timeoutMs: number;
    maxBudgetUsd?: number;
    sessionBusyMaxRetries: number;
    sessionBusyRetryDelayMs: number;
  };
  workspaces: Array<{
    id: string;
    name: string;
    rootPath: string;
    mcpToolIds: string[];
  }>;
  mcpTools: Array<{
    id: string;
    name: string;
    protocol: 'stdio' | 'http' | 'sse';
    permission: 'read_only' | 'read_write';
    enabled: boolean;
    config?: unknown;
  }>;
  onboarding: {
    version: 1;
    completedAt?: string;
    lastRunId?: string;
  };
}

const DEFAULT_HOME = join(homedir(), '.super-helper');

export function defaultConfig(): SuperHelperConfig {
  const cwd = process.cwd();

  return {
    version: 1,
    server: {
      host: '127.0.0.1',
      port: 4317,
      bindMode: 'loopback',
    },
    storage: {
      rootDir: DEFAULT_HOME,
      isolateByWorkspace: true,
    },
    knowledge: {
      rootDir: join(DEFAULT_HOME, 'knowledge'),
      isolateByWorkspace: true,
      buildVectorIndex: false,
    },
    agent: {
      name: 'super helper',
      language: 'zh-CN',
      tone: 'calm_professional',
      useModelForPreflight: false,
      defaultUserPersona: 'operations',
      contextWindowTokens: 200_000,
    },
    models: {
      providers: {},
    },
    embedding: {
      enabled: false,
      provider: 'siliconflow',
      model: 'Qwen/Qwen3-Embedding-0.6B',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      dimensions: 1024,
      distance: 'cosine',
      batchSize: 16,
      timeoutMs: 60_000,
    },
    rerank: {
      enabled: false,
      provider: 'siliconflow',
      model: 'BAAI/bge-reranker-v2-m3',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      timeoutMs: 60_000,
      topN: 2,
    },
    claude: {
      enabled: true,
      command: 'claude',
      commandWhitelist: ['claude'],
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: [
        'Bash',
        'Edit',
        'Write',
        'MultiEdit',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
      ],
      timeoutMs: 1_200_000,
      sessionBusyMaxRetries: 10,
      sessionBusyRetryDelayMs: 10_000,
    },
    workspaces: [
      {
        id: 'current',
        name: 'Current Project',
        rootPath: cwd,
        mcpToolIds: [],
      },
    ],
    mcpTools: [],
    onboarding: {
      version: 1,
    },
  };
}

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
  // 0.2 used to be the implicit default. Treat that legacy value as unset.
  if (parsed.claude?.maxBudgetUsd === 0.2) {
    delete merged.claude.maxBudgetUsd;
  }
  return merged;
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

export function getModelProvider(config: SuperHelperConfig): ModelProviderConfig | undefined {
  if (!config.agent.modelProvider) {
    return undefined;
  }

  return config.models.providers[config.agent.modelProvider];
}

export function getEmbeddingConfig(config: SuperHelperConfig): EmbeddingProviderConfig {
  return config.embedding;
}

export function isEmbeddingEnabled(config: SuperHelperConfig): boolean {
  return config.embedding.enabled === true;
}

export function resolveEmbeddingSecret(config: EmbeddingProviderConfig): string | undefined {
  return resolveSecret(config.apiKey, config.apiKeyEnv);
}

function selectActiveModelProvider(config: SuperHelperConfig): string | undefined {
  if (config.agent.modelProvider && config.models.providers[config.agent.modelProvider]) {
    return config.agent.modelProvider;
  }

  const providerIds = Object.keys(config.models.providers);
  return providerIds.length === 1 ? providerIds[0] : config.agent.modelProvider;
}

export function resolveContextWindowTokens(config: SuperHelperConfig): number {
  const provider = getModelProvider(config);
  return (
    positiveInteger(provider?.contextWindowTokens) ??
    inferModelContextWindowTokens(provider?.model) ??
    positiveInteger(config.agent.contextWindowTokens) ??
    1
  );
}

export function inferModelContextWindowTokens(model?: string): number | undefined {
  const normalized = model?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'minimaxm3') {
    return 1_000_000;
  }

  return undefined;
}

function positiveInteger(value?: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}

export function resolveSecret(value?: string, envName?: string): string | undefined {
  if (value) {
    return value;
  }

  if (envName) {
    return process.env[envName];
  }

  return undefined;
}
