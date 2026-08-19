import {
  REDMINE_CASE_DETAILS_MAX_CHARACTERS,
  type BoundedRedmineCaseDetails,
  type RedmineEvidenceBlockKind,
  type RedmineIssueCaseDetails,
} from '../contracts.js';

const REMOVAL_PRIORITY: Record<RedmineEvidenceBlockKind, number> = {
  attachment_metadata: 0,
  journal: 1,
  custom_field: 2,
  relation: 3,
  status_change: 4,
  description: 5,
};

export function boundCaseDetails(
  input: readonly RedmineIssueCaseDetails[],
  maxCharacters = REDMINE_CASE_DETAILS_MAX_CHARACTERS,
): BoundedRedmineCaseDetails {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 256) {
    throw new Error('Redmine detail character budget must be at least 256');
  }
  const details = structuredClone(input) as RedmineIssueCaseDetails[];
  const originalCharacters = unicodeLength(JSON.stringify({ details }));
  let omittedBlocks = 0;

  while (measure(details, omittedBlocks, originalCharacters) > maxCharacters) {
    const removable = details
      .flatMap((detail, detailIndex) => detail.evidenceBlocks.map((block, blockIndex) => ({
        detailIndex,
        blockIndex,
        priority: REMOVAL_PRIORITY[block.kind],
      })))
      .sort((left, right) => left.priority - right.priority
        || right.detailIndex - left.detailIndex
        || right.blockIndex - left.blockIndex)[0];
    if (!removable) {
      throw new Error('Redmine detail metadata exceeds the configured character budget');
    }
    details[removable.detailIndex].evidenceBlocks.splice(removable.blockIndex, 1);
    omittedBlocks += 1;
  }

  return buildResult(details, omittedBlocks, originalCharacters);
}

function measure(
  details: RedmineIssueCaseDetails[],
  omittedBlocks: number,
  originalCharacters: number,
): number {
  return buildResult(details, omittedBlocks, originalCharacters).outputCharacters;
}

function buildResult(
  details: RedmineIssueCaseDetails[],
  omittedBlocks: number,
  originalCharacters: number,
): BoundedRedmineCaseDetails {
  const result: BoundedRedmineCaseDetails = {
    details,
    omittedBlocks,
    truncated: omittedBlocks > 0,
    originalCharacters,
    outputCharacters: 0,
  };
  for (let index = 0; index < 3; index += 1) {
    result.outputCharacters = unicodeLength(JSON.stringify(result));
  }
  return result;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}
