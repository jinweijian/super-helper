import type { EmbeddingProviderConfig } from '../contract.js';
import { UnsupportedEmbeddingProvider } from '../unsupported.js';

export class QwenEmbeddingProvider extends UnsupportedEmbeddingProvider {
  constructor(config: EmbeddingProviderConfig) {
    super(config, {
      provider: 'qwen',
      code: 'unsupported_provider',
      safeMessage: 'Qwen embedding provider is reserved for a later OpenSpec change and is not implemented in this change.',
    });
  }
}
