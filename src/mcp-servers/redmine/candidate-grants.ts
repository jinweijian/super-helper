import { randomUUID } from 'node:crypto';

export type CandidateGrantErrorCode =
  | 'candidate_grant_unknown'
  | 'candidate_grant_expired'
  | 'candidate_grant_reused'
  | 'candidate_ids_invalid';

export class CandidateGrantError extends Error {
  constructor(readonly code: CandidateGrantErrorCode) {
    super(code);
    this.name = 'CandidateGrantError';
  }
}

interface GrantRecord {
  issueIds: Set<number>;
  expiresAt: number;
  used: boolean;
}

export class CandidateGrantStore {
  private readonly grants = new Map<string, GrantRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(options: {
    ttlMs?: number;
    now?: () => number;
    createId?: () => string;
  } = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    if (!Number.isInteger(this.ttlMs) || this.ttlMs < 1_000 || this.ttlMs > 300_000) {
      throw new Error('candidate grant TTL must be between 1000 and 300000 milliseconds');
    }
  }

  issue(issueIds: readonly number[]): string {
    const unique = validateCandidateIds(issueIds, 10);
    const searchId = this.createId();
    this.grants.set(searchId, {
      issueIds: new Set(unique),
      expiresAt: this.now() + this.ttlMs,
      used: false,
    });
    this.pruneExpired();
    return searchId;
  }

  consume(searchId: string, issueIds: readonly number[]): number[] {
    const unique = validateCandidateIds(issueIds, 3);
    const grant = this.grants.get(searchId);
    if (!grant) throw new CandidateGrantError('candidate_grant_unknown');
    if (grant.expiresAt <= this.now()) {
      this.grants.delete(searchId);
      throw new CandidateGrantError('candidate_grant_expired');
    }
    if (grant.used) throw new CandidateGrantError('candidate_grant_reused');
    if (!unique.every((id) => grant.issueIds.has(id))) {
      throw new CandidateGrantError('candidate_ids_invalid');
    }
    grant.used = true;
    return unique;
  }

  private pruneExpired(): void {
    const current = this.now();
    for (const [id, grant] of this.grants) {
      if (grant.expiresAt <= current) this.grants.delete(id);
    }
  }
}

function validateCandidateIds(issueIds: readonly number[], limit: number): number[] {
  if (issueIds.length < 1 || issueIds.length > limit) {
    throw new CandidateGrantError('candidate_ids_invalid');
  }
  if (issueIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new CandidateGrantError('candidate_ids_invalid');
  }
  const unique = [...new Set(issueIds)];
  if (unique.length !== issueIds.length) throw new CandidateGrantError('candidate_ids_invalid');
  return unique;
}
