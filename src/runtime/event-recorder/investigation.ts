import type { InvestigationExecution } from '../../contracts/investigation.js';
import type { CaseRepository, StoredCase } from '../../sessions/case-repository.js';
import type { InvestigationReason } from '../investigation-policy.js';

export function recordInvestigationMode(
  store: Pick<CaseRepository, 'addLogEvent'>,
  caseSession: StoredCase,
  execution: InvestigationExecution,
  reasonCode: InvestigationReason,
): void {
  store.addLogEvent(caseSession, {
    actor: 'system', phase: 'investigation_mode', label: '排查模式', severity: 'info',
    summary: execution.attempt === 2 ? '自动升级深度排查' : '已选择排查模式',
    detail: { requestedMode: execution.requestedMode, resolvedProfile: execution.resolvedProfile, attempt: execution.attempt, reasonCode },
  });
}

export function recordInvestigationCancellation(
  store: CaseRepository, caseSession: StoredCase, userMessageId: string, placeholderMessageId: string,
): void {
  store.addLogEvent(caseSession, {
    actor: 'system', phase: 'turn_interrupted', label: '用户停止排查', severity: 'warn',
    summary: '当前回合已停止，可重试原问题。',
    detail: {userMessageId, placeholderMessageId, reason: 'user_cancelled'},
  });
}
