import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticLogEvent } from '../domain.js';
import type { AgentModelClient } from '../providers/model/adapter.js';
import type { CaseRepository } from '../sessions/case-repository.js';
import type { StoredCase } from '../sessions/file-memory-store.js';
import type { DiagnosticWorker } from '../workers/diagnostic-worker.js';

export interface RuntimeEventRecorder {
  record(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent;
}

export interface DiagnosticRuntimePorts {
  config: SuperHelperConfig;
  cases: CaseRepository;
  model: AgentModelClient;
  worker: DiagnosticWorker;
  events: RuntimeEventRecorder;
}
