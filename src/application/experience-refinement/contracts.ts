import type { AgentModelClient } from '../../providers/model/adapter.js';
import type { ExperienceDraft, ExperienceReview, ExperienceSource } from '../../knowledge/experience/contracts.js';
import type { RefinementCheckpoint } from '../../knowledge/experience/refinement-progress.js';

export interface RefinementOptions {
  model: AgentModelClient;
  reviewer?: AgentModelClient;
  budget: { remainingCalls: number };
  signal?: AbortSignal;
  beforeCall?: () => void;
  checkpoint?: RefinementCheckpoint;
}
export type RefinementResult = {
  status: 'accepted'; calls: number; source: ExperienceSource; draft: ExperienceDraft; review: ExperienceReview;
} | {
  status: 'quarantined' | 'failed' | 'paused'; calls: number; reason: string;
};
