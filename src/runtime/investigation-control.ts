import type { InvestigationExecution, InvestigationPreference, InvestigationProgress } from '../contracts/investigation.js';

interface ActiveInvestigation {
  userMessageId: string;
  controller: AbortController;
  requestedMode: InvestigationPreference;
  execution?: InvestigationExecution;
  progress: InvestigationProgress;
}

/** 回合控制只驻留当前 Runtime；不持久化 signal、原始工具输出或路径。 */
export class InvestigationControl {
  private readonly active = new Map<string, ActiveInvestigation>();

  begin(caseId: string, userMessageId: string, requestedMode: InvestigationPreference): void {
    if (this.active.has(caseId)) throw new Error('case turn already active');
    this.active.set(caseId, {
      userMessageId, requestedMode, controller: new AbortController(),
      progress: { stage: 'locating', searchCount: 0, filesRead: 0, lastActivityAt: new Date().toISOString() },
    });
  }

  finish(caseId: string, userMessageId: string): void {
    if (this.active.get(caseId)?.userMessageId === userMessageId) this.active.delete(caseId);
  }

  cancel(caseId: string, userMessageId: string): boolean {
    const active = this.active.get(caseId);
    if (!active || active.userMessageId !== userMessageId) return false;
    active.controller.abort();
    return true;
  }

  preference(caseId: string): InvestigationPreference | undefined {
    return this.active.get(caseId)?.requestedMode;
  }

  setExecution(caseId: string, execution: InvestigationExecution): void {
    const active = this.active.get(caseId);
    if (active) active.execution = { ...execution };
  }

  snapshot(caseId: string, userMessageId: string) {
    const active = this.active.get(caseId);
    if (!active || active.userMessageId !== userMessageId) return undefined;
    return {
      userMessageId, requestedMode: active.requestedMode,
      resolvedProfile: active.execution?.resolvedProfile,
      attempt: active.execution?.attempt,
      stopping: active.controller.signal.aborted,
      ...active.progress,
    };
  }

  options(caseId: string) {
    const active = this.active.get(caseId);
    return {
      signal: active?.controller.signal,
      onProgress: (progress: InvestigationProgress) => {
        if (!active || this.active.get(caseId) !== active || active.controller.signal.aborted) return;
        if (!['locating', 'reading', 'verifying', 'summarizing'].includes(progress.stage)) return;
        const count = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
        active.progress = {
          stage: progress.stage,
          searchCount: count(progress.searchCount),
          filesRead: count(progress.filesRead),
          lastActivityAt: new Date().toISOString(),
        };
      },
    };
  }
}
