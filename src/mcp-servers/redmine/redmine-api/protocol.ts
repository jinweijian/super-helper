import * as z from 'zod/v4';

const PositiveIdSchema = z.number().int().positive();
const NonEmptyStringSchema = z.string().min(1);

export const RedmineNamedReferenceSchema = z.object({
  id: PositiveIdSchema.optional(),
  name: NonEmptyStringSchema.optional(),
});

const RedmineProjectReferenceSchema = RedmineNamedReferenceSchema.extend({
  id: PositiveIdSchema,
});

export const RedmineCustomFieldSchema = z.object({
  id: PositiveIdSchema,
  name: NonEmptyStringSchema,
  value: z.union([z.string(), z.array(z.string()), z.null()]),
});

export const RedmineJournalSchema = z.object({
  id: PositiveIdSchema,
  notes: z.string().optional().default(''),
  private_notes: z.boolean().optional().default(false),
  created_on: z.string().optional(),
  user: RedmineNamedReferenceSchema.optional(),
  details: z.array(z.object({
    property: z.string().optional(),
    name: z.string().optional(),
    old_value: z.string().nullable().optional(),
    new_value: z.string().nullable().optional(),
  })).optional().default([]),
});

export const RedmineRelationSchema = z.object({
  id: PositiveIdSchema,
  issue_id: PositiveIdSchema.optional(),
  issue_to_id: PositiveIdSchema.optional(),
  relation_type: z.string().optional(),
  delay: z.number().nullable().optional(),
});

export const RedmineAttachmentSchema = z.object({
  id: PositiveIdSchema,
  filename: z.string().optional(),
  filesize: z.number().int().nonnegative().optional(),
  content_type: z.string().optional(),
  content_url: z.string().optional(),
  description: z.string().optional(),
  author: RedmineNamedReferenceSchema.optional(),
  created_on: z.string().optional(),
});

export const RedmineRawIssueSchema = z.object({
  id: PositiveIdSchema,
  project: RedmineProjectReferenceSchema,
  tracker: RedmineNamedReferenceSchema.optional(),
  status: RedmineNamedReferenceSchema.optional(),
  priority: RedmineNamedReferenceSchema.optional(),
  fixed_version: RedmineNamedReferenceSchema.nullable().optional(),
  subject: z.string().optional().default(''),
  description: z.string().nullable().optional().default(''),
  created_on: z.string().optional(),
  updated_on: z.string().optional(),
  closed_on: z.string().nullable().optional(),
  custom_fields: z.array(RedmineCustomFieldSchema).optional().default([]),
  journals: z.array(RedmineJournalSchema).optional().default([]),
  relations: z.array(RedmineRelationSchema).optional().default([]),
  attachments: z.array(RedmineAttachmentSchema).optional().default([]),
});

export type RedmineRawIssue = z.infer<typeof RedmineRawIssueSchema>;

export const ProjectResponseSchema = z.object({
  project: z.object({
    id: PositiveIdSchema,
    identifier: z.string().min(1),
  }),
});

export const IssuesResponseSchema = z.object({
  issues: z.array(RedmineRawIssueSchema),
  total_count: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const IssueResponseSchema = z.object({
  issue: RedmineRawIssueSchema,
});

export const SearchResponseSchema = z.object({
  results: z.array(z.object({
    id: PositiveIdSchema,
    title: z.string().optional().default(''),
    type: z.string(),
    url: z.string().optional(),
  })),
  total_count: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});
