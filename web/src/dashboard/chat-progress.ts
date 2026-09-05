import type { SessionDto } from '../shared/contracts';

export interface ChatProgressState {
  investigation?: {
    requestedMode: 'auto' | 'fast' | 'deep';
    resolvedProfile?: 'fast' | 'deep';
    attempt?: 1 | 2;
    stage: 'locating' | 'reading' | 'verifying' | 'summarizing';
    searchCount: number;
    filesRead: number;
    lastActivityAt: string;
    stopping?: boolean;
  };
  state: 'idle' | 'running' | 'completed' | 'interrupted' | 'reconnecting';
  startedAt?: number;
  lastActivityAt?: number;
  session?: Pick<SessionDto, 'status' | 'agentActivity' | 'retryableTurn'>;
  error?: string;
}

const defaultSteps = ['理解问题', '知识路由', '检索证据', '证据判断', '生成答复'];
const caseInvestigationSteps = ['查询工单', '分析案例', '验证当前项目', '交叉审核'];

export function progressView(state: ChatProgressState, now = Date.now()) {
  const phase = state.session?.agentActivity?.[0]?.phase ?? '';
  let index = 0;
  let title = '正在理解你的问题';
  let steps = defaultSteps;
  if (/historical_case_search/.test(phase)) { steps = caseInvestigationSteps; index = 0; title = '正在查询工单'; }
  if (/historical_case_analysis/.test(phase)) { steps = caseInvestigationSteps; index = 1; title = '正在分析案例'; }
  if (/current_project_verification/.test(phase)) { steps = caseInvestigationSteps; index = 2; title = '正在验证当前项目'; }
  if (/historical_cross_review/.test(phase)) { steps = caseInvestigationSteps; index = 3; title = '正在交叉审核'; }
  if (/knowledge_router/.test(phase)) { index = 1; title = '正在识别知识路径'; }
  if (/knowledge_search|retrieval/.test(phase)) { index = 2; title = '正在检索相关证据'; }
  if (/judge|review|diagnostic|code_escalation/.test(phase) && !/historical_cross_review/.test(phase) || (!phase && state.session?.status === 'diagnosing')) { index = 3; title = '正在判断证据并排查'; }
  if (/presentation|user_reply/.test(phase)) { index = 4; title = '正在整理回答'; }
  const interrupted = state.state === 'interrupted';
  const reconnecting = state.state === 'reconnecting';
  const elapsed = Math.max(0, now - (state.startedAt ?? now));
  const heartbeat = Math.max(0, now - (state.lastActivityAt ?? state.startedAt ?? now));
  return {
    title: interrupted ? '回答已中断' : reconnecting ? '正在重新连接' : title,
    summary: interrupted ? (state.error || '诊断没有返回回答，请重试或查看日志。') : reconnecting ? '网络连接中断，正在重试…' : (state.session?.agentActivity?.[0]?.summary || '正在处理，本页面会持续更新真实进展。'),
    percent: interrupted ? Math.min(92, 18 + index * 18) : Math.min(92, 18 + index * 18),
    steps, activeIndex: index,
    elapsedLabel: `已耗时 ${formatDuration(elapsed)}`,
    heartbeatLabel: `${Math.floor(heartbeat / 1000)} 秒前有活动`,
    estimateLabel: index >= 3 ? '估计还需 1–3 分钟（非精确时间）' : '估计还需 2–5 分钟（非精确时间）',
    animated: state.state === 'running' || state.state === 'reconnecting',
    stale: heartbeat > 30_000,
  };
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分钟` : `${seconds} 秒`;
}
