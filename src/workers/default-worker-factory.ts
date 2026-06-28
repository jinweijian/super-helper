import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticWorker } from './diagnostic-worker.js';
import { ClaudeCodeWorker } from './claude/claude-code-worker.js';

export type DiagnosticWorkerFactory = (config: SuperHelperConfig) => DiagnosticWorker;

export function createDefaultDiagnosticWorker(config: SuperHelperConfig): DiagnosticWorker {
  return new ClaudeCodeWorker(config);
}
