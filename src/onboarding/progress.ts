import { EventEmitter } from 'node:events';
import type { OnboardingProgressEvent, OnboardingRun, OnboardingStageId } from './types.js';

export const STAGE_WEIGHTS: Record<OnboardingStageId, number> = {
  validate_draft: 3,
  test_providers: 7,
  prepare_workspace: 5,
  ingest_sources: 8,
  extract_sources: 12,
  normalize_sources: 10,
  slice_sources: 15,
  audit_slices: 8,
  publish_approved: 7,
  build_keyword_index: 8,
  build_vector_index: 10,
  health_check: 5,
  commit_config: 2,
};

export class OnboardingProgressHub {
  private readonly emitter = new EventEmitter();

  subscribe(runId: string, listener: (event: OnboardingProgressEvent) => void): () => void {
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }

  publish(event: OnboardingProgressEvent): void {
    this.emitter.emit(event.runId, event);
  }
}

export function calculateOverallProgress(run: OnboardingRun): number {
  const totalWeight = Object.values(STAGE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const completedWeight = run.stages.reduce((sum, stage) => {
    const weight = STAGE_WEIGHTS[stage.id] ?? 0;
    if (stage.status === 'completed' || stage.status === 'skipped') {
      return sum + weight;
    }
    if (stage.status === 'running') {
      return sum + weight * Math.max(0, Math.min(100, stage.progress)) / 100;
    }
    return sum;
  }, 0);
  return Math.min(100, Math.round((completedWeight / totalWeight) * 100));
}
