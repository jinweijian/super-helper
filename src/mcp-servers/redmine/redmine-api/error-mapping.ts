import type { RedmineProbeErrorCode } from '../contracts.js';

export type RedmineOperation = 'project' | 'issues' | 'detail';

export class RedmineProbeError extends Error {
  constructor(readonly code: RedmineProbeErrorCode) {
    super(code);
    this.name = 'RedmineProbeError';
  }
}

export function codeForStatus(status: number, operation: RedmineOperation): RedmineProbeErrorCode {
  if (status === 401) return 'authentication_failed';
  if (status === 403) return 'project_forbidden';
  if (status === 404 && operation === 'project') return 'project_not_found';
  if (status === 429) return 'rate_limited';
  return 'service_unavailable';
}
