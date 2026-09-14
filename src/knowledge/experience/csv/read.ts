import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { CsvParseOptions, ParsedExperienceCsv } from './contracts.js';
import { parseExperienceCsv, validateCsvParseOptions } from './parse.js';

export async function readExperienceCsv(file: string, options: CsvParseOptions = {}): Promise<ParsedExperienceCsv> {
  return parseExperienceCsv(await readExperienceCsvBytes(file, options), options);
}

export async function readExperienceCsvBytes(file: string, options: CsvParseOptions = {}): Promise<Buffer> {
  const validated = validateCsvParseOptions(options);
  // A FIFO must not wait for a writer before we can reject its file type.
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK)
    .catch(() => { throw new Error('CSV_FILE_UNREADABLE'); });
  let input: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('CSV_FILE_UNREADABLE');
    const maxBytes = validated.maxBytes;
    if (stat.size > maxBytes) throw new Error('CSV_SIZE_LIMIT');
    // Bound reads even if another process grows the file after stat.
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error('CSV_SIZE_LIMIT');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    input = Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof Error && ['CSV_SIZE_LIMIT', 'CSV_FILE_UNREADABLE'].includes(error.message)) throw error;
    throw new Error('CSV_FILE_UNREADABLE');
  } finally {
    await handle.close();
  }
  return input;
}
