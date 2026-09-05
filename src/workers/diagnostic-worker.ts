import type { ClaudeWorkerResponse, DiagnosticRequest } from '../domain.js';
import type { InvestigationProgress } from '../contracts/investigation.js';

export interface DiagnosticWorkerOptions {
  signal?: AbortSignal;
  onProgress?: (progress: InvestigationProgress) => void;
}

export type DiagnosticWorkerResponse = ClaudeWorkerResponse;

export interface DiagnosticWorker {
  diagnose(request: DiagnosticRequest, options?: DiagnosticWorkerOptions): Promise<DiagnosticWorkerResponse>;
}
