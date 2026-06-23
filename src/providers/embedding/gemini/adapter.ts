import type { EmbeddingProviderConfig } from '../contract.js';
import { UnsupportedEmbeddingProvider } from '../unsupported.js';

export class GeminiEmbeddingProvider extends UnsupportedEmbeddingProvider {
  constructor(config: EmbeddingProviderConfig) {
    super(config, {
      provider: 'gemini',
      code: 'docs_required',
      safeMessage: 'Gemini embedding adapter requires provider-specific request/response implementation before real calls are available.',
    });
  }
}
