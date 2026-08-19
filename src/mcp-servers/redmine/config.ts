import type { RedmineSearchBackend } from './redmine-api/search.js';

export interface RedmineMcpRuntimeConfig {
  apiKey: string;
  backend: RedmineSearchBackend;
  maxPages: number;
  pageSize: number;
  updatedWithinDays: number;
  cacheTtlMs: number;
  grantTtlMs: number;
}

export function parseRedmineMcpConfig(env: NodeJS.ProcessEnv): RedmineMcpRuntimeConfig {
  const apiKey = env.REDMINE_API_KEY?.trim();
  if (!apiKey) throw new Error('missing_credentials');
  const backend = env.REDMINE_SEARCH_BACKEND ?? 'issues_scan';
  if (backend !== 'rest_search' && backend !== 'issues_scan') throw new Error('invalid_search_backend');
  return {
    apiKey,
    backend,
    maxPages: boundedInteger(env.REDMINE_MAX_PAGES, 3, 1, 20, 'max_pages'),
    pageSize: boundedInteger(env.REDMINE_PAGE_SIZE, 100, 1, 100, 'page_size'),
    updatedWithinDays: boundedInteger(env.REDMINE_UPDATED_WITHIN_DAYS, 730, 1, 3650, 'updated_within_days'),
    cacheTtlMs: boundedInteger(env.REDMINE_CACHE_TTL_MS, 300_000, 1_000, 3_600_000, 'cache_ttl'),
    grantTtlMs: boundedInteger(env.REDMINE_GRANT_TTL_MS, 60_000, 1_000, 300_000, 'grant_ttl'),
  };
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}
