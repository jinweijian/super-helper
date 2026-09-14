import type { AuthorityDiagnosticAdapter, AuthorityDiagnosticOptions, AuthorityDiagnosticResult } from '../contracts/authority-diagnostic.js';

/** @deprecated Use AuthorityDiagnosticAdapter at new module boundaries. */
export type DiagnosticWorkerOptions = AuthorityDiagnosticOptions;
/** @deprecated Use AuthorityDiagnosticResult at new module boundaries. */
export type DiagnosticWorkerResponse = AuthorityDiagnosticResult;
/** Compatibility port for existing Worker consumers. */
export interface DiagnosticWorker extends AuthorityDiagnosticAdapter {}
