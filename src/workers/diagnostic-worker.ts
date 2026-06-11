import type { ClaudeWorkerResponse, DiagnosticRequest } from '../domain.js';

export type DiagnosticWorkerResponse = ClaudeWorkerResponse;

export interface DiagnosticWorker {
  diagnose(request: DiagnosticRequest): Promise<DiagnosticWorkerResponse>;
}
