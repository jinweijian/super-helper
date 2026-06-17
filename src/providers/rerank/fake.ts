import type {
  RerankBatchResult,
  RerankProvider,
  RerankProviderConfig,
  RerankRequestInput,
} from './contract.js';

export class FakeRerankProvider implements RerankProvider {
  readonly id = 'fake';
  readonly model: string;

  constructor(private readonly config: RerankProviderConfig) {
    this.model = config.model;
  }

  async rerank(input: RerankRequestInput): Promise<RerankBatchResult> {
    const queryTerms = normalize(input.query).split('').filter(Boolean);
    const results = input.documents
      .map((document, index) => ({
        id: document.id,
        index,
        score: queryTerms.reduce((sum, term) => sum + (normalize(document.text).includes(term) ? 1 : 0), 0),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.topN ?? this.config.topN ?? input.documents.length);
    return {
      provider: this.id,
      model: this.model,
      results,
      warnings: [],
    };
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?;:：；"'`~\s]/g, '').trim();
}
