import type { DiagnosticLogEvent } from '../domain.js';
import type { StoredCase } from '../sessions/case-repository.js';

export interface RuntimeEventRecorder {
  record(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent;
}
