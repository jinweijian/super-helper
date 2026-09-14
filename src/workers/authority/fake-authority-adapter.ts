import type { AuthorityDiagnosticAdapter, AuthorityDiagnosticOptions, AuthorityDiagnosticResult, DiagnosticRequest } from '../../domain.js';

/** Deterministic adapter for offline contract and UI tests. */
export class FakeAuthorityDiagnosticAdapter implements AuthorityDiagnosticAdapter {
  constructor(private readonly response: AuthorityDiagnosticResult) {}

  async diagnose(_request: DiagnosticRequest, _options?: AuthorityDiagnosticOptions): Promise<AuthorityDiagnosticResult> {
    return structuredClone(this.response);
  }
}
