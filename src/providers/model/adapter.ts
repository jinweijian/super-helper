import type { ModelProviderConfig } from '../../config.js';
import { resolveSecret } from '../../config.js';
import { ModelRequestError, safeModelNetworkError } from './errors.js';

export interface AgentModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AgentModelClient {
  complete(
    messages: AgentModelMessage[],
    options?: { json?: boolean; thinking?: 'enabled' | 'disabled'; signal?: AbortSignal },
  ): Promise<string>;
}

export class NoopModelClient implements AgentModelClient {
  async complete(): Promise<string> {
    throw new Error('No agent model provider configured');
  }
}

export class OpenAICompatibleModelClient implements AgentModelClient {
  constructor(private readonly config: ModelProviderConfig) {}

  async complete(
    messages: AgentModelMessage[],
    options: { json?: boolean; thinking?: 'enabled' | 'disabled'; signal?: AbortSignal } = {},
  ): Promise<string> {
    if (options.signal?.aborted) {
      throw new ModelRequestError('cancelled', 'Model request cancelled');
    }
    const apiKey = resolveSecret(this.config.apiKey, this.config.apiKeyEnv);
    if (!apiKey) {
      throw new ModelRequestError('missing_credentials', 'Missing API key for model');
    }

    const timeoutMs = this.config.timeoutMs ?? 60_000;
    const thinking = options.thinking ?? (options.json ? 'disabled' : undefined);
    const controller = new AbortController();
    let abortCode: 'timeout' | 'cancelled' | undefined;
    const abort = (code: 'timeout' | 'cancelled') => {
      if (abortCode) return;
      abortCode = code;
      controller.abort();
    };
    const onCancel = () => abort('cancelled');
    options.signal?.addEventListener('abort', onCancel, { once: true });
    const timer = setTimeout(() => abort('timeout'), timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature ?? 0,
          max_tokens: this.config.maxTokens ?? 1200,
          messages,
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
          ...(thinking && isDeepSeekApi(this.config.baseUrl)
            ? { thinking: { type: thinking } }
            : {}),
        }),
      });
      if (!response.ok) {
        // 无需读取错误正文，也不把敏感 provider payload 交给调用方。
        await response.body?.cancel();
        throw new ModelRequestError('http_error', `Model request failed: ${response.status}`, response.status);
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (error instanceof SyntaxError) {
          throw new ModelRequestError('malformed_response', 'Model response was not valid JSON');
        }
        throw error;
      }
      const content = (json as { choices?: Array<{ message?: { content?: unknown } }> } | null)
        ?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content) {
        throw new ModelRequestError('malformed_response', 'Model response did not contain message content');
      }
      if (controller.signal.aborted) throw new Error('aborted');
      return content;
    } catch (error) {
      if (abortCode) {
        throw new ModelRequestError(abortCode, abortCode === 'timeout'
          ? `Model request timed out after ${timeoutMs}ms`
          : 'Model request cancelled');
      }
      if (error instanceof ModelRequestError) throw error;
      throw safeModelNetworkError(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onCancel);
    }
  }
}

function isDeepSeekApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.deepseek.com';
  } catch {
    return false;
  }
}

export function createModelClient(config?: ModelProviderConfig): AgentModelClient {
  if (!config) {
    return new NoopModelClient();
  }

  return new OpenAICompatibleModelClient(config);
}
