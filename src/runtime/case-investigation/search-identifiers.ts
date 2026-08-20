import type { RedmineIssueCandidate } from '../../mcp-servers/redmine/contracts.js';

export function opaqueSearchIdentifiers(value: string): string[] {
  const tokens = value.match(/[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*/g) ?? [];
  return [...new Set(tokens
    .map((token) => token.toLocaleLowerCase())
    .filter((token) => token.length >= 4 && /[0-9]/.test(token)))];
}

export function queryPreservesOpaqueIdentifiers(query: string, sourceQuestion: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase();
  return opaqueSearchIdentifiers(sourceQuestion).every((identifier) => normalizedQuery.includes(identifier));
}

export function candidateMatchesOpaqueIdentifier(
  candidate: RedmineIssueCandidate,
  identifiers: string[],
): boolean {
  if (identifiers.length === 0) return true;
  const searchable = `${candidate.subject}\n${candidate.descriptionExcerpt}`.toLocaleLowerCase();
  return identifiers.some((identifier) => searchable.includes(identifier));
}
