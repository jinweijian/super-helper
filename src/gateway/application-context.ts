import { SuperHelperAgent } from '../agent.js';
import { ClaudeCodeWorker } from '../claude-worker.js';
import type { SuperHelperConfig } from '../config.js';
import { resolveSessionStorageRoot } from '../sessions/storage-scope.js';
import { FileMemoryStore } from '../storage.js';

export class GatewayApplicationContext {
  config: SuperHelperConfig;
  store: FileMemoryStore;
  agent: SuperHelperAgent;

  constructor(config: SuperHelperConfig) {
    this.config = config;
    this.store = new FileMemoryStore(resolveSessionStorageRoot(config));
    this.agent = new SuperHelperAgent(config, this.store, new ClaudeCodeWorker(config));
  }

  reload(config: SuperHelperConfig): void {
    this.config = config;
    this.store = new FileMemoryStore(resolveSessionStorageRoot(config));
    this.agent = new SuperHelperAgent(config, this.store, new ClaudeCodeWorker(config));
  }
}
