import { createHash } from 'node:crypto';
import type { ExperienceSource } from './contracts.js';
import { experienceSourceSchema } from './schema.js';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function experienceIdentity(source: Pick<ExperienceSource, 'scope' | 'sourceInstance' | 'sourceProject' | 'ticketId'>): string {
  const values = [source.scope, source.sourceInstance, source.sourceProject, source.ticketId];
  if (values.some((value) => typeof value !== 'string' || !value.trim())) throw new Error('EXPERIENCE_IDENTITY_INVALID');
  return `exp-${sha256(JSON.stringify(values.map((value) => value.trim())))}`;
}

export function sourceRevision(source: ExperienceSource): string {
  const parsed = experienceSourceSchema.safeParse(source);
  if (!parsed.success) throw new Error('EXPERIENCE_SOURCE_INVALID');
  const fields = Object.entries(parsed.data.fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([field, cell]) => [field, cell!.column, cell!.value, cell!.rawHash, cell!.completeness]);
  return sha256(JSON.stringify([experienceIdentity(parsed.data), fields]));
}
