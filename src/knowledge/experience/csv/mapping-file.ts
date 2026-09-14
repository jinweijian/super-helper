import { z } from 'zod';
import { sourceFields } from './mapping.js';
import { readExperienceCsvBytes } from './read.js';
import type { CsvFieldMapping } from './contracts.js';

export async function readExperienceMappingFile(path: string): Promise<CsvFieldMapping> {
  try {
    const bytes = await readExperienceCsvBytes(path, { maxBytes: 64 * 1024 });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = z.partialRecord(z.enum(sourceFields), z.string().min(1).max(200)).safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error();
    return parsed.data;
  } catch { throw new Error('EXPERIENCE_MAPPING_FILE_INVALID'); }
}
