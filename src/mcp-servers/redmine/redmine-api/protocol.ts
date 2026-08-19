import * as z from 'zod/v4';

const PositiveIdSchema = z.number().int().positive();

export const ProjectResponseSchema = z.object({
  project: z.object({
    id: PositiveIdSchema,
    identifier: z.string().min(1),
  }),
});

export const IssuesResponseSchema = z.object({
  issues: z.array(z.object({
    id: PositiveIdSchema,
    project: z.object({ id: PositiveIdSchema }),
  })),
});

export const IssueResponseSchema = z.object({
  issue: z.object({
    id: PositiveIdSchema,
    project: z.object({ id: PositiveIdSchema }),
    journals: z.array(z.object({ id: PositiveIdSchema })).optional().default([]),
    relations: z.array(z.object({ id: PositiveIdSchema })).optional().default([]),
    attachments: z.array(z.object({ id: PositiveIdSchema })).optional().default([]),
  }),
});
