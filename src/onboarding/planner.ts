import type {
  OnboardingDraft,
  OnboardingPlan,
  OnboardingPlanStage,
  OnboardingStageId,
} from './types.js';
import type { KnowledgeVectorCompatibilityStatus } from '../knowledge/vector-index.js';

export interface BuildOnboardingPlanInput {
  draft: OnboardingDraft;
  sourceChanges: {
    added: string[];
    changed: string[];
    unchanged: string[];
  };
  keywordIndexDirty: boolean;
  vectorCompatibility: KnowledgeVectorCompatibilityStatus;
}

export function buildOnboardingPlan(input: BuildOnboardingPlanInput): OnboardingPlan {
  const changedSources = [...input.sourceChanges.added, ...input.sourceChanges.changed];
  const hasSourceDir = Boolean(input.draft.knowledge.sourceDir);
  const runSources = hasSourceDir && changedSources.length > 0;
  const sourceReason = !hasSourceDir
    ? 'No source directory configured.'
    : runSources
      ? `${changedSources.length} source file(s) require processing.`
      : 'All source files are unchanged.';
  const sourceAction = runSources ? 'run' : 'skip';
  const sourceTotal = runSources ? changedSources.length : undefined;

  const stages: OnboardingPlanStage[] = [
    stage('validate_draft', 'run', 'Validate the onboarding draft.'),
    stage('test_providers', 'run', 'Test configured providers.'),
    stage('prepare_workspace', 'run', 'Prepare workspace and knowledge directories.'),
    stage('ingest_sources', sourceAction, sourceReason, sourceTotal),
    stage('extract_sources', sourceAction, sourceReason, sourceTotal),
    stage('normalize_sources', sourceAction, sourceReason, sourceTotal),
    stage('slice_sources', sourceAction, sourceReason, sourceTotal),
    stage('audit_slices', sourceAction, sourceReason),
    stage('publish_approved', sourceAction, sourceReason),
    stage(
      'build_keyword_index',
      input.keywordIndexDirty ? 'run' : 'skip',
      input.keywordIndexDirty ? 'Keyword index is dirty.' : 'Keyword index is current.',
    ),
    stage(
      'build_vector_index',
      shouldBuildVector(input) ? 'run' : 'skip',
      vectorReason(input),
    ),
    stage('health_check', 'run', 'Verify the completed setup.'),
    stage('commit_config', 'run', 'Commit the validated configuration.'),
  ];

  return {
    stages,
    stage(id: OnboardingStageId): OnboardingPlanStage {
      const found = stages.find((item) => item.id === id);
      if (!found) {
        throw new Error(`Unknown onboarding stage: ${id}`);
      }
      return found;
    },
  };
}

function stage(
  id: OnboardingStageId,
  action: 'run' | 'skip',
  reason: string,
  total?: number,
): OnboardingPlanStage {
  return { id, action, reason, total };
}

function shouldBuildVector(input: BuildOnboardingPlanInput): boolean {
  return input.draft.knowledge.buildVectorIndex
    && input.draft.embedding.enabled
    && input.vectorCompatibility !== 'compatible';
}

function vectorReason(input: BuildOnboardingPlanInput): string {
  if (!input.draft.knowledge.buildVectorIndex || !input.draft.embedding.enabled) {
    return 'Vector index is disabled.';
  }
  if (input.vectorCompatibility === 'compatible') {
    return 'Vector index is compatible.';
  }
  return `Vector index requires rebuild: ${input.vectorCompatibility}.`;
}
