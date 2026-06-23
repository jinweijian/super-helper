export function redactProviderErrorMessage(value: unknown): string {
  return serializeForRedaction(value)
    .replace(/(--?(?:api[-_]?key|token|authorization|cookie|password)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(api[-_ ]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(cookie["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(password["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

function serializeForRedaction(value: unknown): string {
  if (isProviderErrorLike(value)) {
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

function isProviderErrorLike(value: unknown): value is {
  name: string;
  provider: string;
  code: string;
  status?: number;
  retryable: boolean;
  safeMessage: string;
  cause?: unknown;
} {
  return typeof value === 'object' &&
    value !== null &&
    'provider' in value &&
    'code' in value &&
    'retryable' in value &&
    'safeMessage' in value;
}
