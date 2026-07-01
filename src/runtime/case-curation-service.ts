import { existsSync } from 'node:fs';
import type { SuperHelperConfig } from '../config.js';
import { knowledgeRoot, resolveKnowledgeWorkspaceRoot } from '../knowledge/index.js';
import type { CaseRepository, StoredCase } from '../sessions/case-repository.js';
import { curateSolvedCase, hasCuratableDiagnosticResult, isResolutionConfirmation } from './case-curator.js';
import type { RuntimeTurnResponse } from './contracts.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';

export class CaseCurationService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: CaseRepository,
    private readonly events: CaseRuntimeEventRecorder,
  ) {}

  answer(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId?: string,
  ): RuntimeTurnResponse | undefined {
    if (!isResolutionConfirmation(userMessage) || !hasCuratableDiagnosticResult(caseSession)) {
      return undefined;
    }

    const workspaceRoot = resolveKnowledgeWorkspaceRoot(this.config, caseSession.workspaceId);
    if (!existsSync(knowledgeRoot(workspaceRoot))) {
      return undefined;
    }

    this.events.caseResolutionConfirmed(caseSession, userMessage);
    this.events.caseCuratorStarted(caseSession);
    const draft = curateSolvedCase({
      workspaceRoot,
      caseSession,
      confirmationMessage: userMessage,
    });
    this.events.caseCuratorResult(caseSession, draft);

    const reply = [
      `已生成 solved case 草稿：${draft.path}`,
      '',
      `状态：${draft.status}`,
      `置信度：${draft.confidence}`,
      '我已把索引标记为 dirty，后续知识库刷新时会重新纳入检索。',
    ].join('\n');

    caseSession.status = 'concluded';
    this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, reply, 'final');
    this.store.saveCase(caseSession);
    return { caseSession, assistantMessage: reply, decision: 'final' };
  }
}
