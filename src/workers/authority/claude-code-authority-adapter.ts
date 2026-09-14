import type { AuthorityDiagnosticAdapter, AuthorityDiagnosticOptions, AuthorityDiagnosticResult, DiagnosticRequest } from '../../domain.js';
import type { DiagnosticWorker } from '../diagnostic-worker.js';

/** Adapts the existing CC worker to the replaceable authority port. */
export class ClaudeCodeAuthorityAdapter implements AuthorityDiagnosticAdapter {
  constructor(private readonly worker: DiagnosticWorker) {}

  diagnose(request: DiagnosticRequest, options?: AuthorityDiagnosticOptions): Promise<AuthorityDiagnosticResult> {
    return this.worker.diagnose(request, options);
  }
}
