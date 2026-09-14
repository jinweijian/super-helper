import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireExperienceLock } from './store-lock.js';
import { renderExperienceArtifact, hashExperienceDraft } from './artifact.js';
import { validateExperienceArtifact } from './artifact-validation.js';
import { experienceIdentity, sha256, sourceRevision } from './provenance.js';
import { atomicStoreBytes, atomicStoreJson, ensureExperienceStore, readStoreBytes, readStoreJson, requireDirectory, writeExclusive } from './store-files.js';
import { batchStateSchema } from './batch-schema.js';
import { publicationManifestSchema, type PublicationManifest, type PublicationEntry } from './publication-schema.js';
import type { ExperienceImportOptions } from './csv/import-contracts.js';

/** 清单是可见性权威。vault 内未被引用的完整或部分文件永不作为知识返回。 */
export class ExperiencePublicationRepository {
  constructor(private readonly root: string, private readonly options: ExperienceImportOptions) {}

  publish(sourceInput: unknown, draftInput: unknown, reviewInput: unknown): PublicationEntry {
    const { source, draft, review } = validateExperienceArtifact(sourceInput, draftInput, reviewInput);
    return this.write(root => {
      if (source.scope !== this.options.scope.trim() || source.sourceInstance !== this.options.sourceInstance.trim()) throw new Error('EXPERIENCE_STORE_SCOPE');
      const id = experienceIdentity(source);
      const revisionHash = sourceRevision(source);
      const state = batchStateSchema.safeParse(readStoreJson(join(root, 'private', 'state.json')));
      if (!state.success || state.data.records[id]?.sourceRevision !== revisionHash) throw new Error('EXPERIENCE_PUBLICATION_STALE_SOURCE');
      const stored = readStoreJson(join(root, 'private', 'records', `${revisionHash}.json`)) as typeof source;
      if (sourceRevision(stored) !== revisionHash || stored.fileHash !== source.fileHash || stored.recordNumber !== source.recordNumber) throw new Error('EXPERIENCE_PUBLICATION_CORRUPT');
      const manifest = this.manifest(root);
      if (!existsSync(join(root, 'private', 'publication.json'))) atomicStoreJson(join(root, 'private', 'publication.json'), manifest);
      const previous = manifest.entries[id];
      if (previous?.lifecycle === 'withdrawn') throw new Error('EXPERIENCE_PUBLICATION_WITHDRAWN');
      if (previous?.sourceRevision === revisionHash && previous.draftHash === hashExperienceDraft(draft)) {
        this.readEntry(root, previous);
        return previous;
      }
      const artifact = renderExperienceArtifact(source, draft, review, (previous?.revision ?? 0) + 1);
      const objectId = sha256(randomUUID());
      const directory = join(root, 'vault', objectId);
      mkdirSync(directory, { mode: 0o700 });
      const sidecar = JSON.stringify(artifact.sidecar);
      const reviewRecord = JSON.stringify({ source, draft, review });
      atomicStoreBytes(join(directory, 'experience.md'), artifact.markdown);
      atomicStoreBytes(join(directory, 'claims.json'), sidecar);
      atomicStoreBytes(join(root, 'private', 'publications', `${objectId}.json`), reviewRecord);
      const entry: PublicationEntry = { experienceId: id, revision: artifact.revision, objectId, sourceRevision: revisionHash,
        draftHash: hashExperienceDraft(draft), contentHash: artifact.contentHash, sidecarHash: sha256(sidecar),
        reviewHash: sha256(reviewRecord), lifecycle: 'published' };
      this.readEntry(root, entry);
      manifest.entries[id] = entry;
      atomicStoreJson(join(root, 'private', 'publication.json'), manifest);
      return entry;
    });
  }

  list() {
    const root = this.resolve(false);
    return Object.values(this.manifest(root).entries).filter(e => e.lifecycle === 'published').map(e => this.readEntry(root, e));
  }

  withdraw(experienceId: string): void {
    this.write(root => {
      const manifest = this.manifest(root);
      const entry = manifest.entries[experienceId];
      if (!entry) throw new Error('EXPERIENCE_PUBLICATION_MISSING');
      entry.lifecycle = 'withdrawn';
      atomicStoreJson(join(root, 'private', 'publication.json'), manifest);
    });
  }

  private readEntry(root: string, entry: PublicationEntry) {
    try {
      const directory = join(root, 'vault', entry.objectId);
      requireDirectory(directory);
      const markdown = readStoreBytes(join(directory, 'experience.md')).toString('utf8');
      const sidecar = readStoreBytes(join(directory, 'claims.json')).toString('utf8');
      const record = readStoreBytes(join(root, 'private', 'publications', `${entry.objectId}.json`)).toString('utf8');
      if (sha256(markdown) !== entry.contentHash || sha256(sidecar) !== entry.sidecarHash || sha256(record) !== entry.reviewHash) throw new Error();
      const parsed = JSON.parse(record);
      if (parsed.source.scope !== this.options.scope.trim() || parsed.source.sourceInstance !== this.options.sourceInstance.trim()) throw new Error();
      const artifact = renderExperienceArtifact(parsed.source, parsed.draft, parsed.review, entry.revision);
      if (artifact.experienceId !== entry.experienceId || artifact.sourceRevision !== entry.sourceRevision
          || hashExperienceDraft(parsed.draft) !== entry.draftHash || artifact.markdown !== markdown || JSON.stringify(artifact.sidecar) !== sidecar) throw new Error();
      return artifact;
    } catch { throw new Error('EXPERIENCE_PUBLICATION_CORRUPT'); }
  }

  private manifest(root: string): PublicationManifest {
    const path = join(root, 'private', 'publication.json');
    if (!existsSync(path)) {
      for (const directory of [join(root, 'vault'), join(root, 'private', 'publications')]) {
        if (existsSync(directory) && readdirSync(directory).length) throw new Error('EXPERIENCE_PUBLICATION_CORRUPT');
      }
      return { version: 1, entries: {} };
    }
    const parsed = publicationManifestSchema.safeParse(readStoreJson(path));
    if (!parsed.success || Object.entries(parsed.data.entries).some(([id, e]) => id !== e.experienceId)) throw new Error('EXPERIENCE_PUBLICATION_CORRUPT');
    return parsed.data;
  }

  private resolve(create: boolean): string {
    const root = ensureExperienceStore(this.root, this.options.scope.trim(), this.options.sourceInstance.trim(), false);
    for (const path of [join(root, 'vault'), join(root, 'private', 'publications')]) {
      if (!existsSync(path)) { if (!create) continue; mkdirSync(path, { mode: 0o700 }); }
      requireDirectory(path);
    }
    return root;
  }

  private write<T>(operation: (root: string) => T): T {
    const root = this.resolve(true);
    const lock = join(root, 'private', 'writer.lock');
    const release = acquireExperienceLock(lock);
    try {
      return operation(root);
    } finally {
      release();
    }
  }
}
