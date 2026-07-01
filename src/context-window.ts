import type { ContextUsage } from './domain.js';
import type { StoredCase } from './sessions/case-repository.js';

export function estimateCaseContextUsage(caseSession: StoredCase, limitTokens: number): ContextUsage {
  const payload = {
    id: caseSession.id,
    title: caseSession.title,
    userPersona: caseSession.userPersona,
    messages: caseSession.messages,
    runs: caseSession.runs.map((run) => ({
      id: run.id,
      status: run.status,
      request: run.request,
      result: run.result,
    })),
    logs: (caseSession.logs ?? []).map((event) => ({
      actor: event.actor,
      phase: event.phase,
      summary: event.summary,
      detail: compactDetail(event.detail),
    })),
  };
  const estimatedTokens = Math.ceil(JSON.stringify(payload).length / 4);
  const safeLimit = Math.max(1, limitTokens || 1);
  const percent = Math.min(999, Math.round((estimatedTokens / safeLimit) * 100));
  const level = percent >= 100 ? 'error' : percent >= 80 ? 'warn' : 'ok';

  return {
    estimatedTokens,
    limitTokens: safeLimit,
    percent,
    level,
    available: percent < 100,
  };
}

function compactDetail(detail: unknown): unknown {
  if (detail === undefined || detail === null) {
    return detail;
  }

  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : detail;
}
