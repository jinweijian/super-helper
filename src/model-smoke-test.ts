import type { ModelProviderConfig } from './config.js';
import { redactEmbeddingErrorMessage } from './embedding/index.js';
import { createModelClient } from './model.js';

export interface ModelSmokeTestResult {
  ok: boolean;
  model: string;
  durationMs: number;
  reply?: string;
  error?: string;
}

export async function runModelSmokeTest(config: ModelProviderConfig): Promise<ModelSmokeTestResult> {
  const startedAt = Date.now();
  try {
    const reply = await createModelClient(config).complete([
      {
        role: 'system',
        content: 'You are a connectivity test for super helper. Reply briefly.',
      },
      {
        role: 'user',
        content: 'super helper model connectivity test. Reply with "ok".',
      },
    ]);
    return {
      ok: true,
      model: config.model,
      durationMs: Date.now() - startedAt,
      reply,
    };
  } catch (error) {
    return {
      ok: false,
      model: config.model,
      durationMs: Date.now() - startedAt,
      error: redactEmbeddingErrorMessage(error),
    };
  }
}
