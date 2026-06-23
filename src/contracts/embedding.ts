export interface EmbeddingDocumentContract {
  id: string;
  text: string;
  contentHash?: string;
  source?: string;
  documentId?: string;
  chunkId?: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingDocumentResultContract {
  id: string;
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  vector: number[];
  contentHash?: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingDocumentPort {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  readonly distance: string;
  embedDocuments(
    input: EmbeddingDocumentContract[],
    options?: { batchSize?: number },
  ): Promise<{ results: EmbeddingDocumentResultContract[] }>;
}

export interface EmbeddingArtifactConfig {
  provider: string;
  model: string;
  dimensions: number;
  distance: string;
  batchSize?: number;
}
