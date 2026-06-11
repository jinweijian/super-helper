import type { CaseMessage, DiagnosticLogEvent, DiagnosticRun } from '../domain.js';
import type { StoredCase } from '../storage.js';

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
  appendDailyMemory(line: string): void;
}
