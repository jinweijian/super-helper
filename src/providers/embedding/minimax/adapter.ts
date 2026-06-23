import type { EmbeddingProviderConfig } from '../contract.js';
import { UnsupportedEmbeddingProvider } from '../unsupported.js';

export class MiniMaxEmbeddingProvider extends UnsupportedEmbeddingProvider {
  constructor(config: EmbeddingProviderConfig) {
    super(config, {
      provider: 'minimax',
      code: 'docs_required',
      safeMessage: 'MiniMax embedding API requires current official embedding documentation before real network calls can be implemented.',
    });
  }
}
