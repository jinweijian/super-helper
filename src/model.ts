import type { ModelProviderConfig } from './config.js';
import { resolveSecret } from './config.js';

export interface AgentModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AgentModelClient {
  complete(messages: AgentModelMessage[], options?: { json?: boolean }): Promise<string>;
}

export class NoopModelClient implements AgentModelClient {
  async complete(): Promise<string> {
    throw new Error('No agent model provider configured');
  }
}

export class OpenAICompatibleModelClient implements AgentModelClient {
  constructor(private readonly config: ModelProviderConfig) {}

  async complete(messages: AgentModelMessage[], options: { json?: boolean } = {}): Promise<string> {
    const apiKey = resolveSecret(this.config.apiKey, this.config.apiKeyEnv);
    if (!apiKey) {
      throw new Error(`Missing API key for model ${this.config.model}`);
    }

    const timeoutMs = this.config.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Model request timed out after ${timeoutMs}ms`);
      }
      throw new Error(formatFetchError(error));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Model response did not contain message content');
    }

    return content;
  }
}

export function createModelClient(config?: ModelProviderConfig): AgentModelClient {
  if (!config) {
    return new NoopModelClient();
  }

  return new OpenAICompatibleModelClient(config);
}

function formatFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
  if (!cause || typeof cause !== 'object') {
    return message;
  }

  const causeCode = 'code' in cause && cause.code ? String(cause.code) : '';
  const causeMessage = cause instanceof Error ? cause.message : 'message' in cause && cause.message ? String(cause.message) : '';
  const detail = [causeCode, causeMessage].filter(Boolean).join(' ');
  return detail ? `${message}: ${detail}` : message;
}
