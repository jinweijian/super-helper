import type { WorkerTrace } from '../../domain.js';
import { sanitizeWorkerTrace } from '../../observability/worker-trace.js';
import { redactProviderErrorMessage } from '../../providers/redaction.js';
import type { StoredCase } from '../../sessions/file-memory-store.js';
import type { EventRecorderWriter } from './common.js';
import { rawOutputSeverity } from './common.js';

export function recordWorkerTrace(
  recorder: EventRecorderWriter,
  caseSession: StoredCase,
  trace: WorkerTrace,
): void {
  const safeTrace = sanitizeWorkerTrace(trace);
  recorder.record(caseSession, {
    actor: 'claude',
    phase: 'command',
    label: '调用 CC',
    severity: safeTrace.error ? 'error' : 'ok',
    summary: '实际调用 Claude Code 的命令',
    detail: {
      command: safeTrace.command,
      cwd: safeTrace.cwd,
      startedAt: safeTrace.startedAt,
      finishedAt: safeTrace.finishedAt,
    },
  });
  recorder.record(caseSession, {
    actor: 'claude',
    phase: 'raw_output',
    label: '调用 CC',
    severity: rawOutputSeverity(safeTrace),
    summary: 'Claude Code 返回的原始数据',
    detail: {
      stdout: redactProviderErrorMessage(safeTrace.stdout),
      stderr: safeTrace.stderr,
      exitCode: safeTrace.exitCode,
      signal: safeTrace.signal,
      error: safeTrace.error,
    },
  });
}
