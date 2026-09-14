import { z } from 'zod';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const publicationEntrySchema = z.strictObject({
  experienceId: z.string().regex(/^exp-[a-f0-9]{64}$/), revision: z.number().int().positive(),
  objectId: hash, sourceRevision: hash, draftHash: hash, contentHash: hash, sidecarHash: hash, reviewHash: hash,
  lifecycle: z.enum(['published', 'withdrawn']),
});
export const publicationManifestSchema = z.strictObject({
  version: z.literal(1), entries: z.record(z.string().regex(/^exp-[a-f0-9]{64}$/), publicationEntrySchema),
});
export type PublicationEntry = z.infer<typeof publicationEntrySchema>;
export type PublicationManifest = z.infer<typeof publicationManifestSchema>;
