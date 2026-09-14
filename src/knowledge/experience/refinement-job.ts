import { z } from 'zod';
import { acquireExperienceLock } from './store-lock.js';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicStoreJson, ensureExperienceStore, readStoreJson, requireDirectory } from './store-files.js';
import { sha256, sourceRevision } from './provenance.js';
import type { ExperienceImportOptions } from './csv/import-contracts.js';
import { validateExperienceArtifact } from './artifact-validation.js';
import { refinementProgressSchema, type RefinementCheckpoint } from './refinement-progress.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const jobSchema = z.strictObject({
  version: z.literal(1), fingerprint: hash, maxCalls: z.number().int().nonnegative(), callsUsed: z.number().int().nonnegative(),
  records: z.record(hash, z.enum(['accepted', 'published', 'quarantined', 'failed'])),
});
type Job = z.infer<typeof jobSchema>;

export class RefinementJob {
  private constructor(private readonly directory: string, readonly state: Job) {}

  static status(rootInput: string, scope: ExperienceImportOptions, jobId: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(jobId)) throw new Error('EXPERIENCE_JOB_ARGUMENTS');
    const root = ensureExperienceStore(rootInput, scope.scope.trim(), scope.sourceInstance.trim(), false);
    const base = join(root, 'private', 'refinement');
    const directory = join(base, sha256(jobId));
    if (!existsSync(directory)) throw new Error('EXPERIENCE_JOB_MISSING');
    requireDirectory(base); requireDirectory(directory);
    const parsed = jobSchema.safeParse(readStoreJson(join(directory, 'job.json')));
    if (!parsed.success || parsed.data.callsUsed > parsed.data.maxCalls) throw new Error('EXPERIENCE_JOB_CORRUPT');
    const counts = Object.values(parsed.data.records);
    return { jobId, execution: 'unknown', callsUsed: parsed.data.callsUsed, maxCalls: parsed.data.maxCalls,
      remainingCalls: parsed.data.maxCalls - parsed.data.callsUsed,
      published: counts.filter(s => s === 'published').length, acceptedPendingPublication: counts.filter(s => s === 'accepted').length,
      quarantined: counts.filter(s => s === 'quarantined').length, failed: counts.filter(s => s === 'failed').length };
  }

  static async use<T>(rootInput: string, scope: ExperienceImportOptions, jobId: string,
    fingerprint: string, maxCalls: number, work: (job: RefinementJob) => Promise<T>): Promise<T> {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(jobId) || !Number.isSafeInteger(maxCalls) || maxCalls < 0) throw new Error('EXPERIENCE_JOB_ARGUMENTS');
    const root = ensureExperienceStore(rootInput, scope.scope.trim(), scope.sourceInstance.trim(), false);
    const base = join(root, 'private', 'refinement');
    if (!existsSync(base)) mkdirSync(base, { mode: 0o700 });
    requireDirectory(base);
    const lock = join(base, 'runner.lock');
    const release = acquireExperienceLock(lock);
    try {
      const directory = join(base, sha256(jobId));
      const existing = existsSync(directory);
      if (!existing) mkdirSync(directory, { mode: 0o700 });
      requireDirectory(directory);
      const path = join(directory, 'job.json');
      if (existing && !existsSync(path)) throw new Error('EXPERIENCE_JOB_CORRUPT');
      const parsed = jobSchema.safeParse(existsSync(path) ? readStoreJson(path) : { version: 1, fingerprint, maxCalls, callsUsed: 0, records: {} });
      if (!parsed.success || parsed.data.callsUsed > parsed.data.maxCalls) throw new Error('EXPERIENCE_JOB_CORRUPT');
      if (parsed.data.fingerprint !== fingerprint || parsed.data.maxCalls !== maxCalls) throw new Error('EXPERIENCE_JOB_CONFIG_MISMATCH');
      const job = new RefinementJob(directory, parsed.data);
      job.save();
      return await work(job);
    } finally { release(); }
  }

  reserveCall(): void {
    if (this.state.callsUsed >= this.state.maxCalls) throw new Error('budget_exhausted');
    this.state.callsUsed++;
    this.save();
  }

  checkpoint(revision: string): RefinementCheckpoint {
    if (!hash.safeParse(revision).success) throw new Error('EXPERIENCE_JOB_ARGUMENTS');
    const path = join(this.directory, `${revision}.progress.json`);
    return {
      load: () => existsSync(path) ? readStoreJson(path) : undefined,
      save: value => {
        const parsed = refinementProgressSchema.safeParse(value);
        if (!parsed.success || parsed.data.sourceRevision !== revision) throw new Error('EXPERIENCE_JOB_CORRUPT');
        atomicStoreJson(path, parsed.data);
      },
    };
  }

  mark(revision: string, status: Job['records'][string]): void {
    if (!hash.safeParse(revision).success) throw new Error('EXPERIENCE_JOB_ARGUMENTS');
    this.state.records[revision] = status;
    this.save();
  }

  accept(revision: string, value: ReturnType<typeof validateExperienceArtifact>): void {
    if (!hash.safeParse(revision).success) throw new Error('EXPERIENCE_JOB_ARGUMENTS');
    if (sourceRevision(value.source) !== revision) throw new Error('EXPERIENCE_JOB_CORRUPT');
    atomicStoreJson(join(this.directory, `${revision}.json`), validateExperienceArtifact(value.source, value.draft, value.review));
    this.mark(revision, 'accepted');
  }

  accepted(revision: string) {
    if (!hash.safeParse(revision).success) throw new Error('EXPERIENCE_JOB_ARGUMENTS');
    const value = readStoreJson(join(this.directory, `${revision}.json`)) as Record<string, unknown>;
    const validated = validateExperienceArtifact(value.source, value.draft, value.review);
    if (sourceRevision(validated.source) !== revision) throw new Error('EXPERIENCE_JOB_CORRUPT');
    return validated;
  }

  private save(): void { atomicStoreJson(join(this.directory, 'job.json'), this.state); }
}
