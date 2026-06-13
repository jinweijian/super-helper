import type {
  DiagnosticLogEvent,
  DiagnosticRequest,
  DiagnosticResult,
  DiagnosticRun,
  LogSeverity,
  UserPersona,
  WorkerTrace,
} from '../domain.js';
import type { KnowledgeEvidencePack, KnowledgeRoute } from '../knowledge/index.js';
import type { PreflightDecision } from '../preflight.js';
import type { CaseRepository } from '../sessions/case-repository.js';
import type { StoredCase } from '../storage.js';
import type { EvidenceJudgeResult } from './evidence-judge.js';
import type { RuntimeEventRecorder } from './ports.js';

export interface ModelPreflightParsed {
  action?: 'ask_user' | 'dispatch';
  reason?: string;
  missingInfo?: string[];
  question?: string;
}

export interface ModelReviewParsed {
  outcome?: 'ask_user' | 'partial' | 'final_answer' | 'escalate_to_human';
  reply?: string;
}

interface AgentIdentity {
  agentId: string;
  agentRole: string;
  agentName: string;
}

const agentIdentities = {
  main: { agentId: 'main', agentRole: 'main-coordinator', agentName: '主 Agent' },
  inputReview: { agentId: 'input-review', agentRole: 'input-review-and-preflight', agentName: '输入审核 Agent' },
  experience: { agentId: 'experience', agentRole: 'prior-session-experience-review', agentName: '经验 Agent' },
  knowledgeRouter: { agentId: 'knowledge-router', agentRole: 'knowledge-router', agentName: '知识路由 Agent' },
  evidenceJudge: { agentId: 'evidence-judge', agentRole: 'evidence-sufficiency-judge', agentName: '证据充分性 Agent' },
  caseCurator: { agentId: 'case-curator', agentRole: 'solved-case-curator', agentName: 'Case 沉淀 Agent' },
  outputReview: { agentId: 'output-review', agentRole: 'evidence-and-output-review', agentName: '输出审核 Agent' },
  presentation: { agentId: 'presentation', agentRole: 'persona-aware-presentation', agentName: '美化输出 Agent' },
} satisfies Record<string, AgentIdentity>;

export class CaseRuntimeEventRecorder implements RuntimeEventRecorder {
  constructor(private readonly cases: Pick<CaseRepository, 'addLogEvent'>) {}

  record(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent {
    return this.cases.addLogEvent(caseSession, event);
  }

  private recordAgent(
    caseSession: StoredCase,
    agent: AgentIdentity,
    event: Omit<DiagnosticLogEvent, 'id' | 'createdAt' | 'agentId' | 'agentRole' | 'agentName'>,
  ): DiagnosticLogEvent {
    return this.record(caseSession, {
      ...event,
      ...agent,
    });
  }

  conversationStarted(caseSession: StoredCase): DiagnosticLogEvent {
    return this.record(caseSession, {
      actor: 'system',
      phase: 'conversation_started',
      label: '开始对话',
      severity: 'ok',
      summary: '创建或初始化当前会话',
      detail: {
        caseId: caseSession.id,
        claudeSessionId: caseSession.claudeSessionId,
        userPersona: caseSession.userPersona,
      },
    });
  }

  inputReceived(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.main, {
      actor: 'agent',
      phase: 'input_received',
      label: '输入',
      severity: 'ok',
      summary: 'Agent 收到用户输入',
      detail: { message, tag: '问的问题' },
    });
  }

  personaApplied(caseSession: StoredCase, personaLabel: string, guide: Record<string, string>): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.main, {
      actor: 'agent',
      phase: 'persona_agent_result',
      label: '用户视角',
      severity: 'ok',
      summary: `${personaLabel}视角已应用`,
      detail: guide,
    });
  }

  inputReviewStarted(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'input_review_started',
      label: '输入审核',
      severity: 'ok',
      summary: '输入审核员开始整理用户输入',
      detail: {
        userPersona: caseSession.userPersona,
        message,
      },
    });
  }

  preflightStarted(
    caseSession: StoredCase,
    detail: { useModelForPreflight: boolean; modelProvider?: string },
  ): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'preflight_started',
      label: '预检',
      severity: 'ok',
      summary: 'Agent 开始执行 Preflight Gate',
      detail,
    });
  }

  localPreflightResult(caseSession: StoredCase, decision: PreflightDecision): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'local_preflight_result',
      label: '输入审核',
      severity: decision.action === 'dispatch' ? 'ok' : 'warn',
      summary: '本地规则预检完成',
      detail: decision,
    });
  }

  modelPreflightFailed(caseSession: StoredCase, error: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'model_preflight_failed',
      label: '预检',
      severity: 'warn',
      summary: 'Agent 模型预检失败，降级到本地规则预检',
      detail: { error },
    });
  }

  modelPreflightResult(caseSession: StoredCase, raw: string, parsed: ModelPreflightParsed): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'model_preflight_result',
      label: '输入审核',
      severity: parsed.action === 'dispatch' ? 'ok' : 'warn',
      summary: 'Agent 模型完成预检判断',
      detail: {
        raw,
        parsed,
      },
    });
  }

  modelPreflightOverriddenByLocalDispatch(
    caseSession: StoredCase,
    modelDecision: PreflightDecision,
    localDecision: PreflightDecision,
  ): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'model_preflight_overridden_by_local_dispatch',
      label: '输入审核',
      severity: 'ok',
      summary: '模型预检提出泛化追问，但当前 workspace 已足够先做只读诊断',
      detail: {
        modelDecision,
        localDecision,
        reason: '当前 workspace 已选中，用户问题包含可搜索业务词或功能定位意图，不应要求用户补充产品/系统/代码库归属。',
      },
    });
  }

  preflightAskUser(caseSession: StoredCase, decision: PreflightDecision): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'preflight_decision',
      label: '预检',
      severity: 'warn',
      summary: 'Preflight Gate 决定先追问用户',
      detail: decision,
    });
  }

  preflightDispatch(caseSession: StoredCase, request: DiagnosticRequest): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'preflight_decision',
      label: '预检',
      severity: 'ok',
      summary: 'Preflight Gate 决定派发 Claude Code 诊断',
      detail: request,
    });
  }

  diagnosticRequestCreated(
    caseSession: StoredCase,
    request: DiagnosticRequest,
    options: { followUp?: boolean } = {},
  ): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.main, {
      actor: 'agent',
      phase: 'diagnostic_request',
      label: '调用 CC',
      severity: 'ok',
      summary: options.followUp ? 'Agent 生成追查 DiagnosticRequest' : 'Agent 生成 DiagnosticRequest',
      detail: request,
    });
  }

  followUpDiagnosticRequested(
    caseSession: StoredCase,
    run: DiagnosticRun,
    result: DiagnosticResult,
  ): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'follow_up_diagnostic_requested',
      label: '输出审核',
      severity: 'warn',
      summary: 'Agent 审核认为证据仍不足，自动追查一轮 Claude Code',
      detail: {
        previousRunId: run.id,
        reason: result.summary,
      },
    });
  }

  evidenceReviewStarted(caseSession: StoredCase, run: DiagnosticRun, result: DiagnosticResult): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'evidence_review_started',
      label: '输出审核',
      severity: 'ok',
      summary: 'Agent 开始审核 Claude Code 返回结果',
      detail: {
        runId: run.id,
        result,
      },
    });
  }

  modelReviewFailed(caseSession: StoredCase, error: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'model_review_failed',
      label: '输出审核',
      severity: 'warn',
      summary: 'Agent 模型审核失败，降级到本地审核规则',
      detail: { error },
    });
  }

  modelReviewResult(caseSession: StoredCase, raw: string, parsed: ModelReviewParsed): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.outputReview, {
      actor: 'agent',
      phase: 'model_review_result',
      label: '输出审核',
      severity: parsed.outcome === 'final_answer' ? 'ok' : 'warn',
      summary: 'Agent 模型完成证据审核与用户回复草拟',
      detail: {
        raw,
        parsed,
      },
    });
  }

  presentationPrepared(caseSession: StoredCase, decision: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.presentation, {
      actor: 'agent',
      phase: 'presentation_agent_result',
      label: '美观输出',
      severity: 'ok',
      summary: '美观输出 agent 完成最终回复整理',
      detail: {
        userPersona: caseSession.userPersona,
        decision,
      },
    });
  }

  preflightReplyCreated(caseSession: StoredCase, reply: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.presentation, {
      actor: 'agent',
      phase: 'user_reply',
      label: '最终输出',
      severity: 'warn',
      summary: 'Agent 向用户发起追问',
      detail: { reply, tag: '最终回答' },
    });
  }

  finalReplyCreated(caseSession: StoredCase, reply: string, decision: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.presentation, {
      actor: 'agent',
      phase: 'user_reply',
      label: '最终输出',
      severity: decision === 'final' ? 'ok' : 'warn',
      summary: 'Agent 完成证据审核并回复用户',
      detail: { reply, decision, tag: '最终回答' },
    });
  }

  turnFailed(caseSession: StoredCase, error: string): DiagnosticLogEvent {
    return this.record(caseSession, {
      actor: 'system',
      phase: 'turn_failed',
      label: '系统',
      severity: 'error',
      summary: '本轮处理异常中断',
      detail: { error },
    });
  }

  experienceStarted(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.experience, {
      actor: 'agent',
      phase: 'experience_started',
      label: '经验',
      severity: 'ok',
      summary: '经验 Agent 开始检查历史会话是否可复用',
      detail: { message },
    });
  }

  experienceMiss(caseSession: StoredCase): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.experience, {
      actor: 'agent',
      phase: 'experience_miss',
      label: '经验',
      severity: 'info',
      summary: '经验 Agent 未找到可安全复用的历史答案',
    });
  }

  experienceHit(
    caseSession: StoredCase,
    detail: { sourceCaseId: string; sourceMessageId: string; sourceReplyId: string; score: number },
  ): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.experience, {
      actor: 'agent',
      phase: 'experience_hit',
      label: '经验',
      severity: 'ok',
      summary: '经验 Agent 找到可复用历史答案，将交给输出审核',
      detail,
    });
  }

  knowledgeRouterStarted(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.knowledgeRouter, {
      actor: 'agent',
      phase: 'knowledge_router_started',
      label: '知识路由',
      severity: 'ok',
      summary: '知识路由 Agent 开始归一化问题',
      detail: { message },
    });
  }

  knowledgeRouterResult(caseSession: StoredCase, route: KnowledgeRoute): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.knowledgeRouter, {
      actor: 'agent',
      phase: 'knowledge_router_result',
      label: '知识路由',
      severity: 'ok',
      summary: '知识路由 Agent 完成模块、意图和关键词识别',
      detail: route,
    });
  }

  knowledgeSearchStarted(caseSession: StoredCase, detail: unknown): DiagnosticLogEvent {
    return this.record(caseSession, {
      actor: 'system',
      phase: 'knowledge_search_started',
      label: '知识检索',
      severity: 'ok',
      summary: '知识搜索服务开始检索企业知识库',
      detail,
    });
  }

  knowledgeSearchResult(caseSession: StoredCase, evidencePack: KnowledgeEvidencePack): DiagnosticLogEvent {
    return this.record(caseSession, {
      actor: 'system',
      phase: 'knowledge_search_result',
      label: '知识检索',
      severity: evidencePack.results.length ? 'ok' : 'warn',
      summary: `知识搜索完成，命中 ${evidencePack.results.length} 条证据`,
      detail: evidencePack,
    });
  }

  evidenceJudgeStarted(caseSession: StoredCase, evidencePack: KnowledgeEvidencePack): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'evidence_judge_started',
      label: '证据判断',
      severity: 'ok',
      summary: '证据充分性 Agent 开始判断知识证据是否足够',
      detail: {
        resultCount: evidencePack.results.length,
      },
    });
  }

  evidenceJudgeResult(caseSession: StoredCase, judge: EvidenceJudgeResult): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'evidence_judge_result',
      label: '证据判断',
      severity: judge.answerable ? 'ok' : 'warn',
      summary: judge.answerable ? '知识证据足够，可进入输出审核' : '知识证据不足，需要升级查询',
      detail: judge,
    });
  }

  knowledgeAnswerSelected(caseSession: StoredCase, result: DiagnosticResult): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'knowledge_answer_selected',
      label: '知识直答',
      severity: 'ok',
      summary: 'Evidence Judge 选择使用知识库证据直接回答',
      detail: result,
    });
  }

  codeEscalationRequested(caseSession: StoredCase, request: DiagnosticRequest): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'code_escalation_requested',
      label: '升级代码',
      severity: 'warn',
      summary: '知识证据不足，升级到 Claude Code 只读静态调查',
      detail: request.context?.deepQuery,
    });
  }

  caseResolutionConfirmed(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'resolution_confirmed',
      label: 'Case 沉淀',
      severity: 'ok',
      summary: '用户确认问题已解决，准备沉淀 solved case',
      detail: { message },
    });
  }

  caseCuratorStarted(caseSession: StoredCase): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'case_curator_started',
      label: 'Case 沉淀',
      severity: 'ok',
      summary: 'Case Curator 开始生成 solved case 草稿',
    });
  }

  caseCuratorResult(
    caseSession: StoredCase,
    detail: { documentId: string; path: string; moduleId: string; status: string; confidence: string },
  ): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.caseCurator, {
      actor: 'agent',
      phase: 'case_curator_result',
      label: 'Case 沉淀',
      severity: 'ok',
      summary: 'Case Curator 已保存 review_required solved case 草稿并标记索引脏',
      detail,
    });
  }

  workerTrace(caseSession: StoredCase, trace: WorkerTrace): void {
    this.record(caseSession, {
      actor: 'claude',
      phase: 'command',
      label: '调用 CC',
      severity: trace.error ? 'error' : 'ok',
      summary: '实际调用 Claude Code 的命令',
      detail: {
        command: trace.command,
        cwd: trace.cwd,
        startedAt: trace.startedAt,
        finishedAt: trace.finishedAt,
      },
    });
    this.record(caseSession, {
      actor: 'claude',
      phase: 'raw_output',
      label: '调用 CC',
      severity: rawOutputSeverity(trace),
      summary: 'Claude Code 返回的原始数据',
      detail: {
        stdout: trace.stdout,
        stderr: trace.stderr,
        exitCode: trace.exitCode,
        signal: trace.signal,
        error: trace.error,
      },
    });
  }
}

function rawOutputSeverity(trace: WorkerTrace): LogSeverity {
  if (trace.error || trace.exitCode) {
    return 'error';
  }
  if (trace.stderr || /"subtype":"error_|error_max_budget_usd|timed out|already in use/i.test(trace.stdout)) {
    return 'warn';
  }
  return 'ok';
}
