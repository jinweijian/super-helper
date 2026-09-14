import { ExperienceBatchRepository } from '../../knowledge/experience/batch-repository.js';
import type { ExperienceImportOptions } from '../../knowledge/experience/csv/import-contracts.js';
import type { CsvParseOptions } from '../../knowledge/experience/csv/contracts.js';
import { readExperienceCsvBytes } from '../../knowledge/experience/csv/read.js';
import { readExperienceMappingFile } from '../../knowledge/experience/csv/mapping-file.js';

export async function importExperienceFile(input: {
  file: string; store: string; scope: ExperienceImportOptions; parse?: CsvParseOptions; signal?: AbortSignal; mappingFile?: string;
}) {
  const bytes = await readExperienceCsvBytes(input.file, input.parse);
  if (input.mappingFile && input.scope.mapping) throw new Error('EXPERIENCE_MAPPING_CONFLICT');
  const scope = input.mappingFile ? { ...input.scope, mapping: await readExperienceMappingFile(input.mappingFile) } : input.scope;
  const repository = new ExperienceBatchRepository(input.store, scope);
  return repository.importCsv(bytes, { ...input.parse, signal: input.signal });
}

export function experienceBatchStatus(store: string, scope: ExperienceImportOptions, batchId: string) {
  return new ExperienceBatchRepository(store, scope).status(batchId);
}
