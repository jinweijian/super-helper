import type { SecretRef } from '../domain.js';

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
  useModelForEvidenceCoverage?: boolean;
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
