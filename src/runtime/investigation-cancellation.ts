import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { recordInvestigationCancellation } from './event-recorder/investigation.js';

export class InvestigationCancelled extends Error {
  constructor() { super('investigation_cancelled'); }
}

export function throwIfInvestigationCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new InvestigationCancelled();
}

export function completeCancelledInvestigation(
  store: CaseRepository, caseSession: StoredCase, userMessageId: string,
): RuntimeTurnResponse {
  // 已审核的初步结果由 Worker diagnosis 保留；此处只负责没有可用结论的中断。
  caseSession.messages = caseSession.messages.filter(message =>
    !(message.role === 'helper' && message.replyToMessageId === userMessageId));
  for (const run of caseSession.runs) {
    if (run.status === 'running' || run.status === 'queued') run.status = 'partial';
  }
  const reply = '排查已停止，尚未形成可审核结论。你可以点击“一键重试”继续原来的问题。';
  const placeholder = store.addMessage(caseSession, {role: 'helper', body: reply, replyToMessageId: userMessageId});
  recordInvestigationCancellation(store, caseSession, userMessageId, placeholder.id);
  caseSession.status = 'partial';
  store.saveCase(caseSession);
  return {caseSession, assistantMessage: reply, decision: 'partial'};
}
