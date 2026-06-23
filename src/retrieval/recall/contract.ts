import type {
  RecallStrategyKind,
  RetrievalCandidate,
  RetrievalInput,
} from '../types.js';

export interface RecallContext {
  workspaceRoot: string;
}

export interface RecallInput extends RetrievalInput {
  limit: number;
}

export interface RecallResult {
  candidates: RetrievalCandidate[];
  filteredOut?: Array<{ reason: string; count: number }>;
}

export interface RecallEnabledResult {
  enabled: boolean;
  reason?: string;
}

export interface RecallStrategy {
  id: string;
  kind: RecallStrategyKind;
  enabled(context: RecallContext): boolean | RecallEnabledResult;
  recall(input: RecallInput): Promise<RecallResult>;
}
