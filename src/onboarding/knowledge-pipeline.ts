import {
  buildDraftSlices,
  discoverSourceFiles,
  extractSourceBlocks,
  initKnowledgeWorkspace,
  intakeSourceDocument,
  normalizeSourceBlocks,
} from '../knowledge/index.js';
import type { OnboardingDraft, OnboardingStageId } from './types.js';

export interface KnowledgeStageProgress {
  stage: OnboardingStageId;
  processed: number;
  total: number;
  message: string;
}

export interface OnboardingKnowledgePipelineResult {
  sources: number;
  reusedSources: number;
  processedSources: number;
  draftSlices: number;
}

export async function runOnboardingKnowledgePipeline(input: {
  draft: OnboardingDraft;
  workspaceRoot: string;
  report(progress: KnowledgeStageProgress): void;
}): Promise<OnboardingKnowledgePipelineResult> {
  initKnowledgeWorkspace({
    workspaceRoot: input.workspaceRoot,
    qualityGate: 'off',
  });

  const files = discoverSourceFiles(input.draft.knowledge.sourceDir)
    .filter((path) => /\.(docx|md|markdown)$/i.test(path));
  const total = files.length;
  const sources = files.map((sourcePath, index) => {
    const result = intakeSourceDocument({
      workspaceRoot: input.workspaceRoot,
      sourcePath,
    });
    input.report({
      stage: 'ingest_sources',
      processed: index + 1,
      total,
      message: result.reused
        ? `Reused ${index + 1}/${total}: ${sourcePath}`
        : `Ingested ${index + 1}/${total}: ${sourcePath}`,
    });
    return result;
  });
  const changed = sources.filter((source) => !source.reused);
  let draftSlices = 0;

  for (let index = 0; index < changed.length; index += 1) {
    const source = changed[index]!;
    const extracted = extractSourceBlocks({
      workspaceRoot: input.workspaceRoot,
      sourceDocumentId: source.sourceDocumentId,
      sourcePath: source.sourcePath,
    });
    input.report(stageProgress('extract_sources', index, changed.length, source.sourcePath));

    const normalized = normalizeSourceBlocks({
      workspaceRoot: input.workspaceRoot,
      sourceDocumentId: source.sourceDocumentId,
      blocks: extracted.blocks,
    });
    input.report(stageProgress('normalize_sources', index, changed.length, source.sourcePath));

    const slices = buildDraftSlices({
      workspaceRoot: input.workspaceRoot,
      sourceDocumentId: source.sourceDocumentId,
      sourceTitle: source.sourceTitle,
      sourceKind: source.sourceKind,
      sourceDocumentPath: source.sourceDocumentRelativePath,
      normalizedBlocks: normalized.blocks,
    });
    draftSlices += slices.draftIds.length;
    input.report(stageProgress('slice_sources', index, changed.length, source.sourcePath));
  }

  return {
    sources: total,
    reusedSources: sources.length - changed.length,
    processedSources: changed.length,
    draftSlices,
  };
}

function stageProgress(
  stage: 'extract_sources' | 'normalize_sources' | 'slice_sources',
  index: number,
  total: number,
  sourcePath: string,
): KnowledgeStageProgress {
  return {
    stage,
    processed: index + 1,
    total,
    message: `${stage} ${index + 1}/${total}: ${sourcePath}`,
  };
}
