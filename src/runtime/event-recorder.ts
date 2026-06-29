import type {
  DiagnosticLogEvent,
  DiagnosticRequest,
  DiagnosticResult,
  DiagnosticRun,
  UserPersona,
  WorkerTrace,
} from '../domain.js';
import type { KnowledgeEvidencePack, KnowledgeRoute } from '../knowledge/index.js';
import type { PreflightDecision } from './preflight-decision.js';
import type { CaseRepository } from '../sessions/case-repository.js';
import type { StoredCase } from '../sessions/file-memory-store.js';
import type { EvidenceJudgeResult } from './evidence-judge.js';
import type { RetrievalTrace } from '../retrieval/types.js';
import type { RuntimeEventRecorder } from './ports.js';
import type { ValidatedDiagnosticResult } from './result-validator.js';
import { redactProviderErrorMessage } from '../providers/redaction.js';
import { agentIdentities, type AgentIdentity } from './events/identities.js';
import {
  diagnosticRequestLogDetail,
  evidenceIdsFromResult,
  type EventRecorderWriter,
} from './events/common.js';
import {
  recordFinalReplyCreated,
  recordModelReviewFailed,
  recordModelReviewResult,
  type ModelReviewParsed,
  recordPreflightReplyCreated,
  recordPresentationPrepared,
} from './events/presentation-events.js';
import {
  recordCaseCuratorResult,
  recordCaseCuratorStarted,
  recordCaseResolutionConfirmed,
  recordCaseReviewFailed,
  recordCaseReviewResult,
  recordCaseReviewStarted,
  recordEvidenceReviewStarted,
  recordEvidenceValidationResult,
  recordFollowUpDiagnosticRequested,
} from './events/review-events.js';
import { recordWorkerTrace } from './events/worker-trace-events.js';

export type { ModelReviewParsed } from './events/presentation-events.js';

export interface ModelPreflightParsed {
  action?: 'ask_user' | 'dispatch';
  reason?: string;
  missingInfo?: string[];
  question?: string;
}

export class CaseRuntimeEventRecorder implements RuntimeEventRecorder, EventRecorderWriter {
  constructor(private readonly cases: Pick<CaseRepository, 'addLogEvent'>) {}

  record(caseSession: StoredCase, event: Omit<DiagnosticLogEvent, 'id' | 'createdAt'>): DiagnosticLogEvent {
    return this.cases.addLogEvent(caseSession, event);
  }

  recordAgent(
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
        raw: redactProviderErrorMessage(raw).slice(0, 2000),
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
      detail: diagnosticRequestLogDetail(request, 'dispatch'),
    });
  }

  preflightKnowledgeAnswer(caseSession: StoredCase, result: DiagnosticResult): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.inputReview, {
      actor: 'agent',
      phase: 'preflight_decision',
      label: '预检',
      severity: 'ok',
      summary: 'Preflight Gate 决定使用知识库证据直接回答',
      detail: {
        decision: 'knowledge_answer',
        status: result.status,
        summary: result.summary,
        recommendedNextAction: result.recommendedNextAction,
        evidenceIds: evidenceIdsFromResult(result),
      },
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
      detail: diagnosticRequestLogDetail(request, options.followUp ? 'follow_up_dispatch' : 'dispatch'),
    });
  }

  followUpDiagnosticRequested(
    caseSession: StoredCase,
    run: DiagnosticRun,
    result: DiagnosticResult,
  ): DiagnosticLogEvent {
    return recordFollowUpDiagnosticRequested(this, caseSession, run, result);
  }

  evidenceReviewStarted(caseSession: StoredCase, run: DiagnosticRun, result: DiagnosticResult): DiagnosticLogEvent {
    return recordEvidenceReviewStarted(this, caseSession, run, result);
  }

  modelReviewFailed(caseSession: StoredCase, error: string): DiagnosticLogEvent {
    return recordModelReviewFailed(this, caseSession, error);
  }

  modelReviewResult(caseSession: StoredCase, raw: string, parsed: ModelReviewParsed): DiagnosticLogEvent {
    return recordModelReviewResult(this, caseSession, raw, parsed);
  }

  evidenceValidationResult(
    caseSession: StoredCase,
    runId: string,
    validation: ValidatedDiagnosticResult,
  ): DiagnosticLogEvent {
    return recordEvidenceValidationResult(this, caseSession, runId, validation);
  }

  presentationPrepared(caseSession: StoredCase, decision: string): DiagnosticLogEvent {
    return recordPresentationPrepared(this, caseSession, decision);
  }

  preflightReplyCreated(caseSession: StoredCase, reply: string): DiagnosticLogEvent {
    return recordPreflightReplyCreated(this, caseSession, reply);
  }

  finalReplyCreated(caseSession: StoredCase, reply: string, decision: string): DiagnosticLogEvent {
    return recordFinalReplyCreated(this, caseSession, reply, decision);
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

  experienceCandidatesRejected(
    caseSession: StoredCase,
    candidates: Array<{
      sourceCaseId: string;
      sourceMessageId: string;
      sourceReplyId?: string;
      sourceRunId?: string;
      score: number;
      rejectionReason: string;
    }>,
  ): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.experience, {
      actor: 'agent',
      phase: 'experience_candidates_rejected',
      label: '经验',
      severity: 'warn',
      summary: `经验 Agent 记录 ${candidates.length} 个未通过当前复核的候选，继续本轮诊断`,
      detail: { candidates },
    });
  }

  experienceHit(
    caseSession: StoredCase,
    detail: { sourceCaseId: string; sourceMessageId: string; sourceReplyId: string; sourceRunId: string; score: number },
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

  knowledgeRetrievalTrace(caseSession: StoredCase, trace: RetrievalTrace): DiagnosticLogEvent {
    return this.record(caseSession, {
      actor: 'system',
      phase: 'knowledge_retrieval_trace',
      label: '检索轨迹',
      severity: trace.strategies.some((strategy) => strategy.status === 'failed') ? 'warn' : 'ok',
      summary: `检索策略 ${trace.strategies.length} 个，最终候选 ${trace.fusion.finalCandidateCount} 条`,
      detail: trace,
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
      detail: {
        status: result.status,
        summary: result.summary,
        missingInfo: result.missingInfo,
        recommendedNextAction: result.recommendedNextAction,
        evidenceIds: evidenceIdsFromResult(result),
        claimCount: result.claims.length,
        evidenceCount: result.evidence.length,
      },
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

  deepQueryRetryRequested(caseSession: StoredCase, detail: {
    attempt: number;
    maxAttempts: number;
    previousArtifactTargets: string[];
    nextArtifactTargets: string[];
    failedReasons: string[];
    correctionActions?: string[];
    stopReason?: string;
  }): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'deep_query_retry_requested',
      label: 'Deep Query 重试',
      severity: 'warn',
      summary: `Deep Query 触发第 ${detail.attempt} 次重试`,
      detail,
    });
  }

  deepQueryPivotSelected(caseSession: StoredCase, detail: {
    attempt: number;
    previousArtifactTargets: string[];
    nextArtifactTargets: string[];
    correctionActions: string[];
  }): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'deep_query_pivot_selected',
      label: 'Deep Query Pivot',
      severity: 'info',
      summary: 'Deep Query 选择新的 pivot 目标',
      detail,
    });
  }

  deepQueryStopped(caseSession: StoredCase, detail: {
    reason: string;
    attempt: number;
    maxAttempts?: number;
    previousArtifactTargets?: string[];
    nextArtifactTargets?: string[];
    failedReasons?: string[];
    correctionActions?: string[];
  }): DiagnosticLogEvent {
    return this.recordAgent(caseSession, agentIdentities.evidenceJudge, {
      actor: 'agent',
      phase: 'deep_query_stopped',
      label: 'Deep Query 停止',
      severity: 'info',
      summary: `Deep Query 停止: ${detail.reason}`,
      detail,
    });
  }

  caseReviewStarted(caseSession: StoredCase, detail: {
    documentId: string;
    action: string;
    reviewer: string;
  }): DiagnosticLogEvent {
    return recordCaseReviewStarted(this, caseSession, detail);
  }

  caseReviewResult(caseSession: StoredCase, detail: {
    documentId: string;
    action: string;
    reviewer: string;
    nextStatus: string;
    targetPath?: string;
  }): DiagnosticLogEvent {
    return recordCaseReviewResult(this, caseSession, detail);
  }

  caseReviewFailed(caseSession: StoredCase, detail: {
    documentId: string;
    reason: string;
  }): DiagnosticLogEvent {
    return recordCaseReviewFailed(this, caseSession, detail);
  }

  caseResolutionConfirmed(caseSession: StoredCase, message: string): DiagnosticLogEvent {
    return recordCaseResolutionConfirmed(this, caseSession, message);
  }

  caseCuratorStarted(caseSession: StoredCase): DiagnosticLogEvent {
    return recordCaseCuratorStarted(this, caseSession);
  }

  caseCuratorResult(
    caseSession: StoredCase,
    detail: { documentId: string; path: string; moduleId: string; status: string; confidence: string },
  ): DiagnosticLogEvent {
    return recordCaseCuratorResult(this, caseSession, detail);
  }

  workerTrace(caseSession: StoredCase, trace: WorkerTrace): void {
    recordWorkerTrace(this, caseSession, trace);
  }
}
