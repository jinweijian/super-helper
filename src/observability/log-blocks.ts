import type { DiagnosticLogEvent, LogSeverity } from '../domain.js';
import type { StoredCase } from '../storage.js';

export interface DiagnosticLogBlock {
  id: string;
  createdAt: string;
  actor: DiagnosticLogEvent['actor'];
  phase: string;
  agentId?: string;
  agentRole?: string;
  agentName?: string;
  label: string;
  severity: LogSeverity;
  title: string;
  summary: string;
  detail?: unknown;
  command?: string;
  tags: string[];
}

export function buildLogBlocks(caseSession: StoredCase): DiagnosticLogBlock[] {
  return (caseSession.logs ?? [])
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      actor: event.actor,
      phase: event.phase,
      agentId: event.agentId,
      agentRole: event.agentRole,
      agentName: event.agentName,
      label: event.label ?? labelForPhase(event.phase),
      severity: event.severity ?? severityForEvent(event),
      title: event.summary,
      summary: event.summary,
      detail: event.detail,
      command: commandForEvent(event),
      tags: tagsForEvent(event),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function formatLogSection(title: string, events: DiagnosticLogEvent[]): string {
  if (!events.length) {
    return `${title}\n暂无记录`;
  }

  return `${title}\n${events.map(formatEvent).join('\n\n')}`;
}

function formatEvent(event: DiagnosticLogEvent): string {
  const detail = event.detail === undefined ? '' : `\n${JSON.stringify(event.detail, null, 2)}`;
  const agent = event.agentName ? ` ${event.agentName}` : '';
  return `[${event.createdAt}]${agent} ${event.phase}\n${event.summary}${detail}`;
}

function commandForEvent(event: DiagnosticLogEvent): string | undefined {
  if (event.phase !== 'command') {
    return undefined;
  }

  const detail = event.detail as { command?: unknown } | undefined;
  return typeof detail?.command === 'string' ? detail.command : undefined;
}

function labelForPhase(phase: string): string {
  if (/conversation_started/.test(phase)) return '开始对话';
  if (/input_received/.test(phase)) return '输入';
  if (/persona/.test(phase)) return '用户视角';
  if (/input_review|preflight_result|model_preflight|local_preflight/.test(phase)) return '输入审核';
  if (/preflight/.test(phase)) return '预检';
  if (/knowledge_router/.test(phase)) return '知识路由';
  if (/knowledge_search/.test(phase)) return '知识检索';
  if (/evidence_judge/.test(phase)) return '证据判断';
  if (/knowledge_answer/.test(phase)) return '知识直答';
  if (/code_escalation/.test(phase)) return '升级代码';
  if (/case_curator|resolution/.test(phase)) return 'Case 沉淀';
  if (/diagnostic|command|raw_output|follow_up/.test(phase)) return '调用 CC';
  if (/evidence_review|model_review|output_review/.test(phase)) return '输出审核';
  if (/presentation/.test(phase)) return '美观输出';
  if (/user_reply/.test(phase)) return '最终输出';
  if (/failed|error/.test(phase)) return '系统';
  return '执行过程';
}

function severityForEvent(event: DiagnosticLogEvent): LogSeverity {
  const detailText = event.detail === undefined ? '' : JSON.stringify(event.detail);
  const text = `${event.phase}\n${event.summary}\n${detailText}`;
  if (/failed|error|timed out|exitCode":\s*[1-9]|Session ID .+ already in use/i.test(text)) {
    return 'error';
  }
  if (/missing|need_input|partial|continue|不足|追问|告警|warn/i.test(text)) {
    return 'warn';
  }
  if (/started|开始|received|收到/i.test(text)) {
    return 'info';
  }
  return 'ok';
}

function tagsForEvent(event: DiagnosticLogEvent): string[] {
  const tags = [event.actor, event.phase];
  if (event.agentName) {
    tags.push(event.agentName);
  }
  if (event.agentId) {
    tags.push(event.agentId);
  }
  const detail = event.detail as { tag?: string; decision?: string; runId?: string } | undefined;
  if (detail?.tag) {
    tags.push(detail.tag);
  }
  if (detail?.decision) {
    tags.push(detail.decision);
  }
  if (detail?.runId) {
    tags.push(detail.runId);
  }
  return tags;
}
