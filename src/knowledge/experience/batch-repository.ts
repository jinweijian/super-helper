import { createHash } from 'node:crypto';
import { acquireExperienceLock } from './store-lock.js';
import { existsSync, readdirSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { join } from 'node:path';
import { parseExperienceCsv } from './csv/parse.js';
import { normalizeExperienceCsv } from './csv/normalize.js';
import type { CsvParseOptions } from './csv/contracts.js';
import type { ExperienceImportOptions } from './csv/import-contracts.js';
import { experienceSourceSchema } from './schema.js';
import { experienceIdentity, sha256, sourceRevision } from './provenance.js';
import { batchStateSchema, type BatchState, type BatchReport, type ImportAudit } from './batch-schema.js';
import { atomicStoreBytes, atomicStoreJson, ensureExperienceStore, readStoreBytes, readStoreJson, writeExclusive } from './store-files.js';

export class ExperienceBatchRepository {
  constructor(private readonly root: string, private readonly options: ExperienceImportOptions) {}

  async importCsv(bytes: Uint8Array, run: CsvParseOptions & { signal?: AbortSignal; onRecord?: (processed: number) => void } = {}): Promise<BatchReport> {
    const parsed = parseExperienceCsv(bytes, run);
    const normalized = normalizeExperienceCsv(parsed, this.options);
    const root = ensureExperienceStore(this.root, this.options.scope.trim(), this.options.sourceInstance.trim(), true);
    const lock = join(root, 'private', 'writer.lock');
    const release = acquireExperienceLock(lock);
    try {
      const state = this.readState(root);
      if (!existsSync(join(root, 'private', 'state.json'))) atomicStoreJson(join(root, 'private', 'state.json'), state);
      const batchId = sha256(JSON.stringify([parsed.fileHash, parsed.encoding, parsed.delimiter,
        this.options.scope.trim(), this.options.sourceInstance.trim(), this.options.sourceProject ?? null,
        Object.entries(this.options.mapping ?? {}).sort(), [...(this.options.redactTerms ?? [])].sort()]));
      const snapshot = join(root, 'private', 'sources', `${parsed.fileHash}.csv`);
      if (!existsSync(snapshot)) atomicStoreBytes(snapshot, bytes);
      else if (createHash('sha256').update(readStoreBytes(snapshot)).digest('hex') !== parsed.fileHash) throw new Error('EXPERIENCE_STORE_CORRUPT');
      // Each record commits its pointer and batch checkpoint together. Replays safely reuse it.
      const report: BatchReport = { batchId, total: normalized.length, processed: 0, imported: 0, skipped: 0, quarantined: 0, status: 'paused' };
      state.audits[batchId] = [];
      for (const item of normalized) {
        await setImmediate(); // Allow actual SIGINT/abort handlers between checkpoints.
        if (run.signal?.aborted) break;
        const audit: ImportAudit = { recordNumber: item.recordNumber, outcome: 'quarantined', flags: item.flags, reason: item.reason };
        if (item.status === 'quarantined' || !item.source) report.quarantined++;
        else {
          const source = item.source;
          const id = experienceIdentity(source);
          const revision = sourceRevision(source);
          audit.sourceRevision = revision;
          const previous = state.records[id];
          const updatedAt = source.fields.updatedAt?.value.trim() || null;
          if (previous?.sourceRevision === revision) { report.skipped++; audit.outcome = 'skipped'; }
          else if (previous && (!updatedAt || !previous.updatedAt || compareDate(updatedAt, previous.updatedAt) <= 0)) {
            report.quarantined++;
            audit.reason = 'revision_conflict';
          }
          else {
            const file = join(root, 'private', 'records', `${revision}.json`);
            if (!existsSync(file)) atomicStoreJson(file, source);
            else if (sourceRevision(experienceSourceSchema.parse(readStoreJson(file))) !== revision) throw new Error('EXPERIENCE_STORE_CORRUPT');
            state.records[id] = { sourceRevision: revision, updatedAt };
            report.imported++;
            audit.outcome = 'imported';
          }
        }
        report.processed++;
        state.audits[batchId].push(audit);
        state.batches[batchId] = { ...report };
        atomicStoreJson(join(root, 'private', 'state.json'), state);
        run.onRecord?.(report.processed);
      }
      report.status = report.processed === report.total ? 'complete' : 'paused';
      state.batches[batchId] = report;
      atomicStoreJson(join(root, 'private', 'state.json'), state);
      return report;
    } catch (error) {
      if (error instanceof Error && /^EXPERIENCE_STORE_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error('EXPERIENCE_STORE_IO');
    } finally {
      release();
    }
  }

  status(batchId: string): BatchReport {
    if (!/^[a-f0-9]{64}$/.test(batchId)) throw new Error('EXPERIENCE_BATCH_INVALID');
    const root = ensureExperienceStore(this.root, this.options.scope.trim(), this.options.sourceInstance.trim(), false);
    const report = this.readState(root).batches[batchId];
    if (!report) throw new Error('EXPERIENCE_BATCH_MISSING');
    return report;
  }

  listPending() {
    const root = ensureExperienceStore(this.root, this.options.scope.trim(), this.options.sourceInstance.trim(), false);
    return Object.entries(this.readState(root).records).map(([id, record]) => {
      const parsed = experienceSourceSchema.safeParse(readStoreJson(join(root, 'private', 'records', `${record.sourceRevision}.json`)));
      if (!parsed.success || sourceRevision(parsed.data) !== record.sourceRevision || experienceIdentity(parsed.data) !== id
          || parsed.data.scope !== this.options.scope.trim() || parsed.data.sourceInstance !== this.options.sourceInstance.trim()) throw new Error('EXPERIENCE_STORE_CORRUPT');
      return { experienceId: id, sourceRevision: record.sourceRevision, source: parsed.data };
    });
  }

  private readState(root: string): BatchState {
    const path = join(root, 'private', 'state.json');
    if (!existsSync(path)) {
      if (readdirSync(join(root, 'private', 'records')).length || readdirSync(join(root, 'private', 'sources')).length) throw new Error('EXPERIENCE_STORE_CORRUPT');
      return { version: 1, records: {}, batches: {}, audits: {} };
    }
    const parsed = batchStateSchema.safeParse(readStoreJson(path));
    if (!parsed.success) throw new Error('EXPERIENCE_STORE_CORRUPT');
    return parsed.data;
  }
}

function compareDate(a: string, b: string): number {
  return Date.parse(`${a.replace(' ', 'T')}Z`) - Date.parse(`${b.replace(' ', 'T')}Z`);
}
