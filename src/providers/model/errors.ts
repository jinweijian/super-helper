export type ModelRequestErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'http_error'
  | 'network_error'
  | 'malformed_response'
  | 'missing_credentials';

const networkCodes = [
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
] as const;
export type ModelNetworkErrorCode = typeof networkCodes[number];

export function safeModelNetworkError(error: unknown): ModelRequestError {
  // 只读取原始字符串 code，不拼接 message/cause，也不调用任意对象的 toString。
  let networkCode: ModelNetworkErrorCode | undefined;
  try {
    const cause = error instanceof Error ? error.cause : undefined;
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
    if (typeof code === 'string' && networkCodes.includes(code as ModelNetworkErrorCode)) {
      networkCode = code as ModelNetworkErrorCode;
    }
  } catch {
    // 不可信 getter 本身失败时也不得泄露异常原文。
  }
  return new ModelRequestError('network_error',
    'Model request failed due to a network error' + (networkCode ? ` (${networkCode})` : ''),
    undefined, networkCode);
}

/** 只携带稳定、安全字段；不保留 provider 原文或底层异常 cause。 */
export class ModelRequestError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: ModelRequestErrorCode,
    message: string,
    readonly status?: number,
    readonly networkCode?: ModelNetworkErrorCode,
  ) {
    super(message);
    this.name = 'ModelRequestError';
    this.retryable = code === 'timeout' || code === 'network_error'
      || (code === 'http_error' && (status === 429 || (status !== undefined && status >= 500)));
  }
}
