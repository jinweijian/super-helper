export interface SiliconFlowEmbeddingResponse {
  model?: string;
  data?: Array<{
    index?: number;
    embedding?: unknown;
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}
