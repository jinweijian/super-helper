import type { SuperHelperConfig } from '../config.js';
import type { CaseStatus, DiagnosticResult, DiagnosticRun, DiagnosticRunStatus } from '../domain.js';
import type { CaseRepository, StoredCase } from './case-repository.js';

const ACTIVE_CASE_STATUSES: CaseStatus[] = ['ready_for_diagnosis', 'diagnosing'];
const ACTIVE_RUN_STATUSES: DiagnosticRunStatus[] = ['queued', 'running'];
const DEFAULT_STALE_TIMEOUT_MS = 30 * 60 * 1000;
const STALE_GRACE_MS = 60 * 1000;

export function recoverStaleActiveTurn(
  caseSession: StoredCase,
  store: CaseRepository,
  config: SuperHelperConfig,
  now = new Date(),
): boolean {
  if (!ACTIVE_CASE_STATUSES.includes(caseSession.status)) {
    return false;
  }

  const updatedAtMs = Date.parse(caseSession.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  const staleAfterMs = activeTurnStaleAfterMs(config);
  const ageMs = now.getTime() - updatedAtMs;
  if (ageMs <= staleAfterMs) {
    return false;
  }

  const previousStatus = caseSession.status;
  const activeRuns = caseSession.runs.filter((run) => ACTIVE_RUN_STATUSES.includes(run.status));
  activeRuns.forEach((run) => recoverRun(run, ageMs, staleAfterMs));
  caseSession.status = 'partial';

  store.addLogEvent(caseSession, {
    actor: 'system',
    phase: 'turn_recovery',
    label: '后台任务恢复',
    severity: 'warn',
    summary: '检测到过期的诊断中会话，已停止前端继续等待。',
    detail: {
      staleAfterMs,
      ageMs,
      recoveredRunIds: activeRuns.map((run) => run.id),
      previousStatus,
    },
  });

  const replyToMessageId = latestUnansweredUserMessageId(caseSession);
  store.addMessage(caseSession, {
    role: 'helper',
    replyToMessageId,
    body: staleTurnReply(activeRuns, staleAfterMs),
  });

  return true;
}

export function activeTurnStaleAfterMs(config: SuperHelperConfig): number {
  const timeoutMs = config.claude.timeoutMs > 0 ? config.claude.timeoutMs : DEFAULT_STALE_TIMEOUT_MS;
  return timeoutMs + STALE_GRACE_MS;
}

function recoverRun(run: DiagnosticRun, ageMs: number, staleAfterMs: number): void {
  run.status = 'partial';
  run.result ??= staleRunResult(run, ageMs, staleAfterMs);
}

function staleRunResult(run: DiagnosticRun, ageMs: number, staleAfterMs: number): DiagnosticResult {
  const evidenceId = `ev_${run.id}_stale`;
  return {
    status: 'partial',
    summary: '后台诊断已超时，系统已停止继续等待本轮 Claude Code 结果。',
    missingInfo: [
      '本轮 Claude Code 是否完成，以及是否产出可用的代码或知识库证据。',
      '后台任务中断前的最后一段原始输出。',
    ],
    evidence: [
      {
        id: evidenceId,
        kind: 'log',
        source: run.id,
        summary: `会话保持运行中超过 ${formatDuration(staleAfterMs)}，最近一次状态更新距今约 ${formatDuration(ageMs)}。`,
        confidence: 'high',
      },
    ],
    claims: [
      {
        type: 'unknown',
        role: 'unknown',
        text: '无法确认本轮诊断已经得到有效证据。',
        evidenceIds: [evidenceId],
        answers: [],
      },
    ],
    recommendedNextAction: 'continue_diagnosis',
  };
}

function staleTurnReply(activeRuns: DiagnosticRun[], staleAfterMs: number): string {
  const runText = activeRuns.length > 0
    ? `遗留运行：${activeRuns.map((run) => run.id).join(', ')}。`
    : '没有找到仍在运行的 run，可能停在进入诊断队列阶段。';

  return [
    '后台诊断已超时，我已停止继续显示“诊断中”。',
    '',
    `原因：这个会话超过 ${formatDuration(staleAfterMs)} 没有新的运行结果，可能是服务重启、Claude Code 中断或后台任务丢失后遗留了运行中状态。`,
    runText,
    '',
    '当前不能把这次排查当作有效结论。请重新发送问题，或先查看诊断日志确认中断点。',
  ].join('\n');
}

function latestUnansweredUserMessageId(caseSession: StoredCase): string | undefined {
  const repliedMessageIds = new Set(
    caseSession.messages
      .filter((message) => message.role === 'helper' && message.replyToMessageId)
      .map((message) => message.replyToMessageId),
  );
  return [...caseSession.messages]
    .reverse()
    .find((message) => message.role === 'user' && !repliedMessageIds.has(message.id))
    ?.id;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds} 秒`;
  }
  if (seconds === 0) {
    return `${minutes} 分钟`;
  }
  return `${minutes} 分 ${seconds} 秒`;
}
