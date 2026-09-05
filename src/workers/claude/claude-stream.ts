import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { InvestigationProgress } from '../../contracts/investigation.js';

/** 原始协议仅存在于适配器内存；只输出最终 envelope 和安全计数。 */
export class ClaudeStream {
  private pending = '';
  private dropping = false;
  private files = new Set<string>();
  private tools = new Set<string>();
  private searchCount = 0;
  result = '';
  constructor(private readonly cwd: string, private readonly onProgress?: (progress: InvestigationProgress) => void) {}

  push(chunk: string): void {
    for (const part of chunk.split(/(?<=\n)/)) {
      if (!this.dropping) this.pending += part;
      if (this.pending.length > 5 * 1024 * 1024) {
        this.pending = '';
        this.dropping = true;
      }
      if (part.endsWith('\n')) {
        if (!this.dropping) this.consume(this.pending);
        this.pending = '';
        this.dropping = false;
      }
    }
  }

  finish(): void {
    if (!this.dropping && this.pending) this.consume(this.pending);
    this.pending = '';
  }

  private consume(line: string): void {
    try {
      const event = JSON.parse(line);
      if (event?.type === 'result') {
        this.result = JSON.stringify({ type: 'result', subtype: ['success', 'error_max_turns', 'error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries'].includes(event.subtype) ? event.subtype : 'error_during_execution',
          ...(event.subtype === 'success' && typeof event.result === 'string' ? { result: event.result } : {}) });
        this.publish('summarizing');
      }
      if (event?.type !== 'assistant' || !Array.isArray(event.message?.content)) return;
      for (const item of event.message.content) {
        if (item?.type !== 'tool_use' || typeof item.id !== 'string' || this.tools.has(item.id)) continue;
        if (!['Read', 'Grep', 'Glob'].includes(item.name)) continue;
        this.tools.add(item.id);
        if (item.name === 'Read') {
          const file = this.safeFile(item.input?.file_path);
          if (file) this.files.add(file);
          this.publish('reading');
        } else {
          this.searchCount += 1;
          this.publish('locating');
        }
      }
    } catch { /* 无效事件在边界丢弃。 */ }
  }

  private safeFile(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.includes('\0')) return undefined;
    try {
      const root = realpathSync(this.cwd);
      const file = realpathSync(resolve(root, value));
      const path = relative(root, file);
      return path && path !== '..' && !path.startsWith('../') && !isAbsolute(path) ? file : undefined;
    } catch { return undefined; }
  }

  private publish(stage: InvestigationProgress['stage']): void {
    try { this.onProgress?.({ stage, searchCount: this.searchCount, filesRead: this.files.size, lastActivityAt: new Date().toISOString() }); }
    catch { /* 观测回调不得影响子进程生命周期。 */ }
  }
}
