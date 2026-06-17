import { redactProviderErrorMessage } from './redaction.js';

export type ProviderErrorCode =
  | 'missing_credentials'
  | 'unsupported_provider'
  | 'docs_required'
  | 'timeout'
  | 'rate_limited'
  | 'invalid_request'
  | 'provider_error'
  | 'malformed_response'
  | 'dimension_mismatch'
  | 'network_error'
  | 'disabled';

export class ProviderError extends Error {
  readonly provider: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly safeMessage: string;

  constructor(input: {
    provider: string;
    code: ProviderErrorCode;
    retryable: boolean;
    safeMessage: string;
    status?: number;
    cause?: unknown;
  }) {
    super(redactProviderErrorMessage(input.safeMessage), { cause: input.cause });
    this.name = 'ProviderError';
    this.provider = input.provider;
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status;
    this.safeMessage = redactProviderErrorMessage(input.safeMessage);
  }
}

export class EmbeddingProviderError extends ProviderError {
  constructor(input: {
    provider: string;
    code: ProviderErrorCode;
    retryable: boolean;
    safeMessage: string;
    status?: number;
    cause?: unknown;
  }) {
    super(input);
    this.name = 'EmbeddingProviderError';
  }
}

export type EmbeddingProviderErrorCode = ProviderErrorCode;

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function isEmbeddingProviderError(error: unknown): error is EmbeddingProviderError {
  return error instanceof ProviderError;
}

export function formatProviderSafeError(error: unknown): string {
  if (isProviderError(error)) {
    const status = error.status === undefined ? '' : ` status=${error.status}`;
    return `${error.provider}:${error.code}${status}: ${error.safeMessage}`;
  }

  return redactProviderErrorMessage(error);
}

export const formatEmbeddingSafeError = formatProviderSafeError;
export const redactEmbeddingErrorMessage = redactProviderErrorMessage;
