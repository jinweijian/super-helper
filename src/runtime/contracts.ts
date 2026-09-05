import type { StoredCase } from '../sessions/case-repository.js';

export type RuntimeDecision = 'ask_user' | 'dispatched' | 'final' | 'partial' | 'escalate';

export interface RuntimeTurnResponse {
  /** 仅内部使用：冻结投影中存在可展示的已审核事实或推断。 */
  hasReviewedAnswer?: boolean;
  caseSession: StoredCase;
  assistantMessage: string;
  decision: RuntimeDecision;
}

export interface ReviewPresentationResult {
  hasReviewedAnswer?: boolean;
  reply: string;
  decision: RuntimeDecision;
  caseStatus: StoredCase['status'];
}

export interface AcceptedUserTurn {
  caseSession: StoredCase;
  userMessageId: string;
}
