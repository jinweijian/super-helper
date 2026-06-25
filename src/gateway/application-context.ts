import type { SuperHelperConfig } from '../config.js';
import { DiagnosticRuntime } from '../runtime/diagnostic-runtime.js';
import { resolveSessionStorageRoot } from '../sessions/storage-scope.js';
import { FileMemoryStore } from '../storage.js';
import { ClaudeCodeWorker } from '../workers/claude/claude-code-worker.js';

export class GatewayApplicationContext {
  config: SuperHelperConfig;
  store: FileMemoryStore;
  agent: DiagnosticRuntime;

  constructor(config: SuperHelperConfig) {
    this.config = config;
    this.store = new FileMemoryStore(resolveSessionStorageRoot(config));
    this.agent = new DiagnosticRuntime(config, this.store, new ClaudeCodeWorker(config));
  }

  reload(config: SuperHelperConfig): void {
    this.config = config;
    this.store = new FileMemoryStore(resolveSessionStorageRoot(config));
    this.agent = new DiagnosticRuntime(config, this.store, new ClaudeCodeWorker(config));
  }
}
