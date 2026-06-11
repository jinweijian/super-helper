import type { SupperHelperConfig } from '../config.js';
import type { DiagnosticLogEvent } from '../domain.js';
import type { AgentModelClient } from '../model.js';
import type { CaseRepository } from '../sessions/case-repository.js';
import type { StoredCase } from '../storage.js';
import type { DiagnosticWorker } from '../workers/diagnostic-worker.js';

export interface RuntimeEventRecorder {
  record(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent;
}

export interface DiagnosticRuntimePorts {
  config: SupperHelperConfig;
  cases: CaseRepository;
  model: AgentModelClient;
  worker: DiagnosticWorker;
  events: RuntimeEventRecorder;
}
