import { ProviderError } from './errors.js';

export type ProviderFetch = typeof fetch;

export interface ProviderRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  batchSize?: number;
  requestId?: string;
}

export interface ProviderUsage {
  inputTokens?: number;
  totalTokens?: number;
  providerRequestCount?: number;
  raw?: Record<string, unknown>;
}

export interface ProviderFactoryOptions {
  fetch?: ProviderFetch;
}

export function resolveApiKey(config: {
  apiKey?: string;
  apiKeyEnv?: string;
}): string | undefined {
  if (config.apiKey) {
    return config.apiKey;
  }
  if (config.apiKeyEnv) {
    return process.env[config.apiKeyEnv];
  }
  return undefined;
}

export function joinProviderEndpoint(baseUrl: string | undefined, defaultBaseUrl: string, suffix: string): string {
  const normalized = (baseUrl ?? defaultBaseUrl).replace(/\/+$/, '');
  return `${normalized}/${suffix.replace(/^\/+/, '')}`;
}

export function parseJsonBody(bodyText: string, input: {
  provider: string;
  safeMessage: string;
}): unknown {
  if (!bodyText.trim()) {
    return {};
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new ProviderError({
      provider: input.provider,
      code: 'malformed_response',
      retryable: false,
      safeMessage: input.safeMessage,
    });
  }
}

export function parseJsonBodyIfPossible(bodyText: string): unknown {
  if (!bodyText.trim()) {
    return {};
  }
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}

export function isProviderObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function providerStatusError(input: {
  provider: string;
  status: number;
  parsed: unknown;
  bodyText?: string;
  operation: string;
}): ProviderError {
  const message = extractProviderMessage(input.parsed) ??
    (input.bodyText?.trim()
      ? input.bodyText.slice(0, 1000)
      : `${input.provider} ${input.operation} request failed with status ${input.status}.`);
  if (input.status === 401 || input.status === 403) {
    return new ProviderError({ provider: input.provider, code: 'missing_credentials', retryable: false, status: input.status, safeMessage: message });
  }
  if (input.status === 429) {
    return new ProviderError({ provider: input.provider, code: 'rate_limited', retryable: true, status: input.status, safeMessage: message });
  }
  if (input.status >= 400 && input.status < 500) {
    return new ProviderError({ provider: input.provider, code: 'invalid_request', retryable: false, status: input.status, safeMessage: message });
  }
  return new ProviderError({ provider: input.provider, code: 'provider_error', retryable: true, status: input.status, safeMessage: message });
}

function extractProviderMessage(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!isProviderObject(value)) {
    return undefined;
  }
  if (typeof value.message === 'string') {
    return value.message;
  }
  if (typeof value.error === 'string') {
    return value.error;
  }
  return undefined;
}
