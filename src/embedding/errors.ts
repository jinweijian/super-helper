import type { EmbeddingProviderId } from './types.js';

export type EmbeddingProviderErrorCode =
  | 'missing_credentials'
  | 'unsupported_provider'
  | 'docs_required'
  | 'timeout'
  | 'rate_limited'
  | 'invalid_request'
  | 'provider_error'
  | 'malformed_response'
  | 'dimension_mismatch'
  | 'network_error';

export class EmbeddingProviderError extends Error {
  readonly provider: EmbeddingProviderId | string;
  readonly code: EmbeddingProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly safeMessage: string;

  constructor(input: {
    provider: EmbeddingProviderId | string;
    code: EmbeddingProviderErrorCode;
    retryable: boolean;
    safeMessage: string;
    status?: number;
    cause?: unknown;
  }) {
    super(redactEmbeddingErrorMessage(input.safeMessage), { cause: input.cause });
    this.name = 'EmbeddingProviderError';
    this.provider = input.provider;
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status;
    this.safeMessage = redactEmbeddingErrorMessage(input.safeMessage);
  }
}

export function isEmbeddingProviderError(error: unknown): error is EmbeddingProviderError {
  return error instanceof EmbeddingProviderError;
}

export function formatEmbeddingSafeError(error: unknown): string {
  if (isEmbeddingProviderError(error)) {
    const status = error.status === undefined ? '' : ` status=${error.status}`;
    return `${error.provider}:${error.code}${status}: ${error.safeMessage}`;
  }

  return redactEmbeddingErrorMessage(error);
}

export function redactEmbeddingErrorMessage(value: unknown): string {
  return serializeForRedaction(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(api[-_ ]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(cookie["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

function serializeForRedaction(value: unknown): string {
  if (value instanceof EmbeddingProviderError) {
    return JSON.stringify({
      name: value.name,
      provider: value.provider,
      code: value.code,
      status: value.status,
      retryable: value.retryable,
      safeMessage: value.safeMessage,
      cause: value.cause,
    });
  }

  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      cause: value.cause,
    });
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
