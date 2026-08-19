import {
  REDMINE_PROJECT_IDENTIFIER,
  type RedmineProbeErrorCode,
} from './contracts.js';
import { createRedmineReadonlyClient } from './redmine-api/client.js';
import { RedmineProbeError } from './redmine-api/error-mapping.js';

export type RedmineProbeResult =
  | {
      ok: true;
      project: { identifier: typeof REDMINE_PROJECT_IDENTIFIER; numericId: number };
      issueList: { sampleCount: 0 | 1; includesAllStatuses: true };
      issueDetail: {
        status: 'ok' | 'skipped_no_issue';
        journalCount: number;
        relationCount: number;
        attachmentCount: number;
      };
    }
  | { ok: false; code: RedmineProbeErrorCode };

export async function runRedmineReadonlyProbe(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<RedmineProbeResult> {
  if (!input.apiKey.trim()) {
    return { ok: false, code: 'missing_credentials' };
  }

  try {
    const client = createRedmineReadonlyClient(input);
    const project = await client.getProject();
    const issues = await client.listLatestIssue(project.id);
    const issue = issues[0];
    if (!issue) {
      return {
        ok: true,
        project: { identifier: REDMINE_PROJECT_IDENTIFIER, numericId: project.id },
        issueList: { sampleCount: 0, includesAllStatuses: true },
        issueDetail: {
          status: 'skipped_no_issue',
          journalCount: 0,
          relationCount: 0,
          attachmentCount: 0,
        },
      };
    }

    const detail = await client.getIssueDetail(issue.id, project.id);
    return {
      ok: true,
      project: { identifier: REDMINE_PROJECT_IDENTIFIER, numericId: project.id },
      issueList: { sampleCount: 1, includesAllStatuses: true },
      issueDetail: {
        status: 'ok',
        journalCount: detail.journalCount,
        relationCount: detail.relationCount,
        attachmentCount: detail.attachmentCount,
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof RedmineProbeError ? error.code : 'service_unavailable',
    };
  }
}
