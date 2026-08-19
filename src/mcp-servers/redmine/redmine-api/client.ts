import type * as z from 'zod/v4';
import {
  REDMINE_ORIGIN,
  REDMINE_PROJECT_IDENTIFIER,
  REDMINE_TIMEOUT_MS,
  type RedmineReadonlyClient,
} from '../contracts.js';
import { codeForStatus, RedmineProbeError, type RedmineOperation } from './error-mapping.js';
import { IssueResponseSchema, IssuesResponseSchema, ProjectResponseSchema } from './protocol.js';

export interface CreateRedmineReadonlyClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createRedmineReadonlyClient(
  options: CreateRedmineReadonlyClientOptions,
): RedmineReadonlyClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REDMINE_TIMEOUT_MS;

  async function request<T>(
    pathname: string,
    query: ReadonlyArray<readonly [string, string]>,
    schema: z.ZodType<T>,
    operation: RedmineOperation,
  ): Promise<T> {
    const url = new URL(pathname, `${REDMINE_ORIGIN}/`);
    for (const [key, value] of query) url.searchParams.set(key, value);
    if (url.origin !== REDMINE_ORIGIN) {
      throw new RedmineProbeError('project_scope_mismatch');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'X-Redmine-API-Key': options.apiKey,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RedmineProbeError('timeout');
      }
      throw new RedmineProbeError('service_unavailable');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new RedmineProbeError(codeForStatus(response.status, operation));
    }
    if (response.redirected || (response.url && new URL(response.url).origin !== REDMINE_ORIGIN)) {
      throw new RedmineProbeError('service_unavailable');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RedmineProbeError('invalid_response');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new RedmineProbeError('invalid_response');
    }
    return parsed.data;
  }

  return {
    async getProject() {
      const result = await request(
        `/projects/${REDMINE_PROJECT_IDENTIFIER}.json`,
        [],
        ProjectResponseSchema,
        'project',
      );
      if (result.project.identifier !== REDMINE_PROJECT_IDENTIFIER) {
        throw new RedmineProbeError('project_scope_mismatch');
      }
      return { id: result.project.id, identifier: result.project.identifier };
    },

    async listLatestIssue(projectId) {
      const result = await request(
        '/issues.json',
        [
          ['project_id', String(projectId)],
          ['status_id', '*'],
          ['sort', 'updated_on:desc'],
          ['limit', '1'],
        ],
        IssuesResponseSchema,
        'issues',
      );
      const issues = result.issues.slice(0, 1).map((issue) => ({
        id: issue.id,
        projectId: issue.project.id,
      }));
      if (issues.some((issue) => issue.projectId !== projectId)) {
        throw new RedmineProbeError('project_scope_mismatch');
      }
      return issues;
    },

    async getIssueDetail(issueId, expectedProjectId) {
      const result = await request(
        `/issues/${issueId}.json`,
        [['include', 'journals,relations,attachments']],
        IssueResponseSchema,
        'detail',
      );
      if (result.issue.id !== issueId || result.issue.project.id !== expectedProjectId) {
        throw new RedmineProbeError('project_scope_mismatch');
      }
      return {
        projectId: result.issue.project.id,
        journalCount: result.issue.journals.length,
        relationCount: result.issue.relations.length,
        attachmentCount: result.issue.attachments.length,
      };
    },
  };
}
