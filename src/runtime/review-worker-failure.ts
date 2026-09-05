import type { DiagnosticRun } from '../domain.js';
import type { SafeWorkerFailureCategory } from './safe-failure-presentation.js';

/** 失败日志不是领域证据，不能让一次失败调用进入事实表达。 */
export function workerFailedBeforeUsableResult(run: DiagnosticRun): boolean {
  const trace = run.workerTrace;
  const failed = Boolean(trace && (
    trace.error || trace.signal || (trace.exitCode !== undefined && trace.exitCode !== 0)
  ));
  if (!failed) return false;
  return !run.result?.evidence.some(evidence => (
    evidence.kind !== 'log' && evidence.confidence !== 'low'
  ));
}

export function workerFailureCategory(run: DiagnosticRun): SafeWorkerFailureCategory {
  const trace = run.workerTrace;
  if (trace?.signal) return 'worker_interrupted';
  if (trace?.error && /timed?\s*out|timeout/i.test(trace.error)) return 'worker_timeout';
  return 'worker_execution_failed';
}
