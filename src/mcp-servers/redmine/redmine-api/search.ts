import type { RedmineApiClient } from './client.js';
import type { RedmineRawIssue } from './protocol.js';

export type RedmineSearchBackend = 'rest_search' | 'issues_scan';

export interface RedmineIssueSearchInput {
  query: string;
  signals: string[];
  limit: number;
}

export interface RedmineIssueSearch {
  readonly backend: RedmineSearchBackend;
  search(input: RedmineIssueSearchInput): Promise<RedmineRawIssue[]>;
}

interface CreateRedmineIssueSearchOptions {
  client: RedmineApiClient;
  backend: RedmineSearchBackend;
  projectId: number;
  maxPages: number;
  pageSize: number;
  updatedWithinDays: number;
  cacheTtlMs: number;
  now?: () => Date;
}

interface CachedIssueScan {
  expiresAt: number;
  issues: RedmineRawIssue[];
}

export function createRedmineIssueSearch(options: CreateRedmineIssueSearchOptions): RedmineIssueSearch {
  validateBounds(options);
  const now = options.now ?? (() => new Date());
  let cache: CachedIssueScan | undefined;

  async function scanIssues(): Promise<RedmineRawIssue[]> {
    const currentTime = now().getTime();
    if (cache && cache.expiresAt > currentTime) return cache.issues;

    const issues: RedmineRawIssue[] = [];
    const updatedOnGte = new Date(currentTime - options.updatedWithinDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (let page = 0; page < options.maxPages; page += 1) {
      const offset = page * options.pageSize;
      const result = await options.client.listIssuePage({
        projectId: options.projectId,
        offset,
        limit: options.pageSize,
        updatedOnGte,
      });
      issues.push(...result.issues);
      if (result.issues.length < options.pageSize || offset + result.issues.length >= result.totalCount) break;
    }
    cache = {
      expiresAt: currentTime + options.cacheTtlMs,
      issues,
    };
    return issues;
  }

  async function restSearch(input: RedmineIssueSearchInput): Promise<RedmineRawIssue[]> {
    const ids = await options.client.searchIssueIds(input.query, Math.min(30, Math.max(input.limit, 10)));
    const results: RedmineRawIssue[] = [];
    for (const id of ids) {
      const issue = await options.client.getRawIssue(id);
      if (issue.project.id === options.projectId) results.push(issue);
      if (results.length >= input.limit) break;
    }
    return results;
  }

  return {
    backend: options.backend,
    async search(input) {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) {
        throw new Error('candidate limit must be between 1 and 10');
      }
      if (options.backend === 'rest_search') return restSearch(input);
      const issues = await scanIssues();
      return rankIssues(issues, input).slice(0, input.limit);
    },
  };
}

function validateBounds(options: CreateRedmineIssueSearchOptions): void {
  const valid = Number.isInteger(options.projectId)
    && options.projectId > 0
    && Number.isInteger(options.maxPages)
    && options.maxPages >= 1
    && options.maxPages <= 20
    && Number.isInteger(options.pageSize)
    && options.pageSize >= 1
    && options.pageSize <= 100
    && Number.isInteger(options.updatedWithinDays)
    && options.updatedWithinDays >= 1
    && options.updatedWithinDays <= 3650
    && Number.isInteger(options.cacheTtlMs)
    && options.cacheTtlMs >= 1
    && options.cacheTtlMs <= 3_600_000;
  if (!valid) throw new Error('invalid Redmine search bounds');
}

function rankIssues(issues: readonly RedmineRawIssue[], input: RedmineIssueSearchInput): RedmineRawIssue[] {
  const queryTerms = uniqueTerms([input.query]);
  const signalTerms = uniqueTerms(input.signals);
  return issues
    .map((issue) => ({
      issue,
      score: scoreIssue(issue, queryTerms) * 2 + scoreIssue(issue, signalTerms),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score
      || compareUpdatedAt(right.issue.updated_on, left.issue.updated_on)
      || right.issue.id - left.issue.id)
    .map((item) => item.issue);
}

function uniqueTerms(values: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized) terms.add(normalized);
    for (const token of normalized.split(/[\s,，。；;、/]+/u)) {
      if (token.length >= 2) terms.add(token);
    }
  }
  return [...terms];
}

function scoreIssue(issue: RedmineRawIssue, terms: readonly string[]): number {
  const subject = issue.subject.toLocaleLowerCase();
  const description = (issue.description ?? '').toLocaleLowerCase();
  let score = 0;
  for (const term of terms) {
    if (subject.includes(term)) score += 3;
    if (description.includes(term)) score += 1;
  }
  return score;
}

function compareUpdatedAt(left?: string, right?: string): number {
  return (Date.parse(left ?? '') || 0) - (Date.parse(right ?? '') || 0);
}
