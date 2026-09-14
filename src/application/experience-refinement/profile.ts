import type { CsvFieldMapping, CsvParseOptions, ExperienceCsvProfile } from '../../knowledge/experience/csv/contracts.js';
import { readExperienceCsv } from '../../knowledge/experience/csv/read.js';
import { profileExperienceCsv } from '../../knowledge/experience/csv/profile.js';

export async function profileExperienceFile(
  file: string, options: CsvParseOptions = {}, mapping: CsvFieldMapping = {},
): Promise<ExperienceCsvProfile> {
  return profileExperienceCsv(await readExperienceCsv(file, options), mapping);
}
