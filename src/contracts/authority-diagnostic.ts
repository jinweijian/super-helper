import type { DiagnosticRequest, ClaudeWorkerResponse } from './diagnostic.js';
import type { InvestigationProgress } from './investigation.js';

/** Stable port for the component that owns technical diagnosis. */
export interface AuthorityDiagnosticOptions {
  signal?: AbortSignal;
  onProgress?: (progress: InvestigationProgress) => void;
}

export type AuthorityDiagnosticResult = ClaudeWorkerResponse;

export interface AuthorityDiagnosticAdapter {
  diagnose(
    request: DiagnosticRequest,
    options?: AuthorityDiagnosticOptions,
  ): Promise<AuthorityDiagnosticResult>;
}
