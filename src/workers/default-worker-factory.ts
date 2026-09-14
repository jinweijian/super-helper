import type { SuperHelperConfig } from '../config.js';
import type { AuthorityDiagnosticAdapter } from '../contracts/authority-diagnostic.js';
import { ClaudeCodeWorker } from './claude/claude-code-worker.js';
import { ClaudeCodeAuthorityAdapter } from './authority/claude-code-authority-adapter.js';

export type DiagnosticWorkerFactory = (config: SuperHelperConfig) => AuthorityDiagnosticAdapter;

export function createDefaultDiagnosticWorker(config: SuperHelperConfig): AuthorityDiagnosticAdapter {
  return new ClaudeCodeAuthorityAdapter(new ClaudeCodeWorker(config));
}
