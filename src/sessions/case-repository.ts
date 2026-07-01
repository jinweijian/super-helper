import type { CaseMessage, CaseSession, DiagnosticLogEvent, DiagnosticRun } from '../domain.js';

export interface StoredCase extends CaseSession {
  createdAt: string;
  updatedAt: string;
}

export interface CaseRepository {
  createCase(input: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    title: string;
  }): StoredCase;
  loadCase(caseId: string): StoredCase | undefined;
  listCases(limit?: number): StoredCase[];
  saveCase(caseSession: StoredCase): void;
  addMessage(caseSession: StoredCase, message: Omit<CaseMessage, 'id' | 'createdAt'>): CaseMessage;
  addRun(caseSession: StoredCase, run: DiagnosticRun): DiagnosticRun;
  addLogEvent(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent;
  updateTitle(caseSession: StoredCase, title: string): StoredCase;
  pinCase(caseSession: StoredCase): StoredCase;
  unpinCase(caseSession: StoredCase): StoredCase;
  archiveCase(caseSession: StoredCase): StoredCase;
  deleteCase(caseId: string): boolean;
  appendDailyMemory(line: string): void;
}
