import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { SuperHelperConfig } from '../config.js';
import { getModelProvider } from '../config.js';
import type { DiagnosticRequest, DiagnosticResult, DiagnosticRun, UserPersona } from '../domain.js';
import type { PreflightDecision } from '../preflight.js';
import type { AgentModelClient } from '../model.js';
import { createModelClient } from '../model.js';
import type { ClaudeWorker } from '../claude-worker.js';
import type { FileMemoryStore, StoredCase } from '../storage.js';
import {
  knowledgeRoot,
  resolveKnowledgeWorkspaceRoot,
} from '../knowledge/index.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import {
  buildDiagnosticRequest as createDiagnosticRequest,
  buildFollowUpDiagnosticRequest as createFollowUpDiagnosticRequest,
} from './request-builder.js';
import { buildLocalPreflightDecision, isGenericWorkspaceFollowUp, summarizePreflightDecision } from './preflight-gate.js';
import {
  caseStatusFromDiagnosticResult,
  decisionFromDiagnosticResult,
  decisionFromReviewOutcome,
  shouldRunFollowUp,
} from './review-gate.js';
import {
  formatPreflightQuestion,
  formatReviewFailureFallback,
  personaGuide,
  personaName,
  ruleBasedReviewAndFormat,
} from './presenter.js';
import { resolveAgentConfig } from './agent-configs.js';
import { findExperienceMatch } from './experience-agent.js';
import { curateSolvedCase, hasCuratableDiagnosticResult, isResolutionConfirmation } from './case-curator.js';
import {
  attachKnowledgeCodeEscalationContext,
  diagnosticResultFromKnowledge,
  prepareKnowledgeDiagnosis,
} from './knowledge-diagnosis.js';
import { parseAgentModelJson } from './agent-model-review.js';
import {
  applyWorkerResponseToRun,
  createRunningDiagnosticRun,
  prepareDeepQueryRetry,
} from './worker-turn.js';

export interface AgentResponse {
  caseSession: StoredCase;
  assistantMessage: string;
  decision: 'ask_user' | 'dispatched' | 'final' | 'partial' | 'escalate';
}

export class DiagnosticRuntime {
  private readonly model: AgentModelClient;
  private readonly mainAgentSpec: string;
  private readonly inputReviewAgentSpec: string;
  private readonly experienceAgentSpec: string;
  private readonly outputReviewAgentSpec: string;
  private readonly presentationAgentSpec: string;
  private readonly events: CaseRuntimeEventRecorder;
  private readonly caseTurnQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: FileMemoryStore,
    private readonly worker: ClaudeWorker,
  ) {
    this.model = createModelClient(getModelProvider(config));
    this.mainAgentSpec = resolveAgentConfig('main').content;
    this.inputReviewAgentSpec = resolveAgentConfig('preflight').content;
    this.experienceAgentSpec = resolveAgentConfig('experience').content;
    this.outputReviewAgentSpec = resolveAgentConfig('output_review').content;
    this.presentationAgentSpec = resolveAgentConfig('presentation').content;
    this.events = new CaseRuntimeEventRecorder(store);
  }

  async handleUserMessage(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): Promise<AgentResponse> {
    const caseSession = this.startUserTurn(input);
    return this.completeUserTurn(caseSession.id, input.message);
  }

  loadCase(caseId: string): StoredCase | undefined {
    return this.store.loadCase(caseId);
  }

  startUserTurn(input: {
    caseId?: string;
    message: string;
    workspaceId?: string;
    persona?: UserPersona;
  }): StoredCase {
    const caseSession = this.loadOrCreateCase(input);
    if (caseSession.archivedAt) {
      throw new Error('session is archived and cannot continue');
    }
    if (input.persona) {
      caseSession.userPersona = input.persona;
    } else {
      caseSession.userPersona ??= this.config.agent.defaultUserPersona;
    }
    if (caseSession.messages.length === 0) {
      this.events.conversationStarted(caseSession);
    }
    if (isGenericTitle(caseSession.title)) {
      caseSession.title = titleFromMessage(input.message);
    }
    this.store.addMessage(caseSession, { role: 'user', body: input.message });
    this.events.inputReceived(caseSession, input.message);
    this.events.personaApplied(caseSession, personaName(caseSession.userPersona), personaGuide(caseSession.userPersona));
    this.events.inputReviewStarted(caseSession, input.message);
    caseSession.status = 'ready_for_diagnosis';
    this.store.saveCase(caseSession);
    return caseSession;
  }

  async completeUserTurn(caseId: string, userMessage: string): Promise<AgentResponse> {
    const previous = this.caseTurnQueues.get(caseId) ?? Promise.resolve();
    const task = previous.then(
      () => this.completeUserTurnNow(caseId, userMessage),
      () => this.completeUserTurnNow(caseId, userMessage),
    );
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.caseTurnQueues.set(caseId, tail);
    try {
      return await task;
    } finally {
      if (this.caseTurnQueues.get(caseId) === tail) {
        this.caseTurnQueues.delete(caseId);
      }
    }
  }

  private async completeUserTurnNow(caseId: string, userMessage: string): Promise<AgentResponse> {
    const caseSession = this.store.loadCase(caseId);
    if (!caseSession) {
      throw new Error(`case ${caseId} not found`);
    }
    if (caseSession.archivedAt) {
      throw new Error('session is archived and cannot continue');
    }
    const replyToMessageId = findPendingUserMessageId(caseSession, userMessage);

    const curationResponse = this.answerFromResolutionConfirmation(caseSession, userMessage, replyToMessageId);
    if (curationResponse) {
      return curationResponse;
    }

    const experienceResponse = await this.answerFromExperience(caseSession, userMessage, replyToMessageId);
    if (experienceResponse) {
      return experienceResponse;
    }

    const decision = await this.decide(caseSession, userMessage);
    if (decision.action === 'ask_user') {
      this.events.preflightAskUser(caseSession, decision);
      const reply = formatPreflightQuestion(decision.question, decision.missingInfo);
      this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
      this.events.preflightReplyCreated(caseSession, reply);
      this.store.appendDailyMemory(`- ${new Date().toISOString()} ${caseSession.id} preflight ask: ${decision.missingInfo.join(', ')}`);
      caseSession.status = 'need_input';
      this.store.saveCase(caseSession);
      return { caseSession, assistantMessage: reply, decision: 'ask_user' };
    }

    const knowledgeResponse = await this.answerFromKnowledge(caseSession, userMessage, replyToMessageId, decision.request);
    if (knowledgeResponse) {
      return knowledgeResponse;
    }

    caseSession.status = 'diagnosing';
    this.events.preflightDispatch(caseSession, decision.request);
    const run = createRunningDiagnosticRun({
      request: decision.request,
      caseId: caseSession.id,
    });
    this.store.addRun(caseSession, run);
    this.events.diagnosticRequestCreated(caseSession, decision.request);
    this.store.appendDailyMemory(`- ${new Date().toISOString()} ${caseSession.id} dispatch ${run.id}`);

    const workerResponse = await this.worker.diagnose(decision.request);
    const result = applyWorkerResponseToRun({ run, response: workerResponse });
    caseSession.status = caseStatusFromDiagnosticResult(result);
    this.store.saveCase(caseSession);
    this.events.workerTrace(caseSession, workerResponse.trace);

    let review = await this.reviewAndFormat(caseSession, result, run);
    if (shouldRunFollowUp(review, result, workerResponse.trace)) {
      const deepRetry = prepareDeepQueryRetry({
        previousRequest: decision.request,
        previousResult: result,
        workerTrace: workerResponse.trace,
        reviewDecision: review.decision,
      });
      if (deepRetry.stop) {
        this.events.deepQueryStopped(caseSession, deepRetry.stop);
      } else {
        this.events.followUpDiagnosticRequested(caseSession, run, result);
      const followUpRequest = createFollowUpDiagnosticRequest({
        caseSession,
        previousRequest: decision.request,
        previousResult: result,
      });
        if (deepRetry.retry) {
          followUpRequest.context ??= {
            isFollowUp: true,
            currentUserMessage: followUpRequest.userGoal,
            recentMessages: [],
            previousRuns: [],
          };
          followUpRequest.context.knowledge = decision.request.context?.knowledge;
          followUpRequest.context.deepQuery = deepRetry.retry.deepQuery;
          followUpRequest.constraints = Array.from(new Set([
            ...followUpRequest.constraints,
            'Deep Query retry: continue read-only investigation with the pivoted artifact targets.',
            `Pivot artifact targets: ${deepRetry.retry.deepQuery.artifactTargets.join(', ')}`,
            `Correction actions: ${deepRetry.retry.deepQuery.correctionActions.join(', ')}`,
          ]));
          this.events.deepQueryRetryRequested(caseSession, {
            attempt: deepRetry.retry.deepQuery.attempt ?? 2,
            maxAttempts: deepRetry.retry.deepQuery.maxAttempts ?? 2,
            previousArtifactTargets: deepRetry.retry.deepQuery.previousArtifactTargets ?? [],
            nextArtifactTargets: deepRetry.retry.deepQuery.artifactTargets,
            failedReasons: deepRetry.retry.deepQuery.failedReasons ?? [],
            correctionActions: deepRetry.retry.deepQuery.correctionActions,
          });
          this.events.deepQueryPivotSelected(caseSession, {
            attempt: deepRetry.retry.deepQuery.attempt ?? 2,
            previousArtifactTargets: deepRetry.retry.deepQuery.previousArtifactTargets ?? [],
            nextArtifactTargets: deepRetry.retry.deepQuery.artifactTargets,
            correctionActions: deepRetry.retry.deepQuery.correctionActions,
          });
        }
      const followUpRun = createRunningDiagnosticRun({
        request: followUpRequest,
        caseId: caseSession.id,
      });
      this.store.addRun(caseSession, followUpRun);
      this.events.diagnosticRequestCreated(caseSession, followUpRequest, { followUp: true });
      const followUpResponse = await this.worker.diagnose(followUpRequest);
      applyWorkerResponseToRun({ run: followUpRun, response: followUpResponse });
      caseSession.status = caseStatusFromDiagnosticResult(followUpResponse.result);
      this.store.saveCase(caseSession);
      this.events.workerTrace(caseSession, followUpResponse.trace);
      review = await this.reviewAndFormat(caseSession, followUpResponse.result, followUpRun);
      }
    }

    const reply = review.reply;
    this.events.presentationPrepared(caseSession, review.decision);
    this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, reply, review.decision);
    return { caseSession, assistantMessage: reply, decision: review.decision };
  }

  private answerFromResolutionConfirmation(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId?: string,
  ): AgentResponse | undefined {
    if (!isResolutionConfirmation(userMessage) || !hasCuratableDiagnosticResult(caseSession)) {
      return undefined;
    }

    const workspaceRoot = this.knowledgeWorkspaceRootFor(caseSession.workspaceId);
    if (!existsSync(knowledgeRoot(workspaceRoot))) {
      return undefined;
    }

    this.events.caseResolutionConfirmed(caseSession, userMessage);
    this.events.caseCuratorStarted(caseSession);
    const draft = curateSolvedCase({
      workspaceRoot,
      caseSession,
      confirmationMessage: userMessage,
    });
    this.events.caseCuratorResult(caseSession, draft);

    const reply = [
      `已生成 solved case 草稿：${draft.path}`,
      '',
      `状态：${draft.status}`,
      `置信度：${draft.confidence}`,
      '我已把索引标记为 dirty，后续知识库刷新时会重新纳入检索。',
    ].join('\n');

    caseSession.status = 'concluded';
    this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, reply, 'final');
    this.store.saveCase(caseSession);
    return { caseSession, assistantMessage: reply, decision: 'final' };
  }

  recordTurnFailure(caseId: string, error: unknown, replyToMessageId?: string): void {
    const caseSession = this.store.loadCase(caseId);
    if (!caseSession) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const reply = `请求中断了，我没有继续假装思考。\n\n原因：${message}\n\n请打开“查看诊断日志”查看卡在哪一步。`;
    caseSession.status = 'partial';
    this.events.turnFailed(caseSession, message);
    this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
    this.store.saveCase(caseSession);
  }

  private loadOrCreateCase(input: { caseId?: string; message: string; workspaceId?: string }): StoredCase {
    if (input.caseId) {
      const existing = this.store.loadCase(input.caseId);
      if (existing) {
        return existing;
      }
    }

    const workspaceId = input.workspaceId ?? this.config.workspaces[0]?.id ?? 'current';
    return this.store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId,
      title: titleFromMessage(input.message),
    });
  }

  private async decide(caseSession: StoredCase, userMessage: string): Promise<PreflightDecision> {
    this.events.preflightStarted(caseSession, {
      useModelForPreflight: this.config.agent.useModelForPreflight,
      modelProvider: this.config.agent.modelProvider,
    });

    const localDecision = buildLocalPreflightDecision({
      config: this.config,
      caseSession,
      userMessage,
    });

    if (this.config.agent.useModelForPreflight && this.config.agent.modelProvider) {
      try {
        const modelDecision = await this.modelDrivenPreflight(caseSession, userMessage, localDecision);
        if (modelDecision) {
          return this.reconcilePreflightDecisions(caseSession, modelDecision, localDecision);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.appendDailyMemory(`- ${new Date().toISOString()} model preflight failed: ${message}`);
        this.events.modelPreflightFailed(caseSession, message);
      }
    }

    this.events.localPreflightResult(caseSession, localDecision);
    return localDecision;
  }

  private async answerFromExperience(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId?: string,
  ): Promise<AgentResponse | undefined> {
    this.events.experienceStarted(caseSession, userMessage);
    const match = findExperienceMatch({
      store: this.store,
      currentCase: caseSession,
      userMessage,
    });

    if (!match) {
      this.events.experienceMiss(caseSession);
      return undefined;
    }

    this.events.experienceHit(caseSession, {
      sourceCaseId: match.sourceCaseId,
      sourceMessageId: match.sourceMessageId,
      sourceReplyId: match.sourceReplyId,
      score: match.score,
    });
    const run: DiagnosticRun = {
      id: `run_${randomUUID().slice(0, 8)}`,
      caseId: caseSession.id,
      status: match.result.status,
      result: match.result,
    };
    this.store.addRun(caseSession, run);
    caseSession.status = caseStatusFromDiagnosticResult(match.result);
    this.store.saveCase(caseSession);
    const review = await this.reviewAndFormat(caseSession, match.result, run);
    const reply = review.reply;
    this.events.presentationPrepared(caseSession, review.decision);
    this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, reply, review.decision);
    return { caseSession, assistantMessage: reply, decision: review.decision };
  }

  private async answerFromKnowledge(
    caseSession: StoredCase,
    userMessage: string,
    replyToMessageId: string | undefined,
    request: DiagnosticRequest,
  ): Promise<AgentResponse | undefined> {
    const workspaceRoot = this.knowledgeWorkspaceRootFor(caseSession.workspaceId);
    this.events.knowledgeRouterStarted(caseSession, userMessage);
    const diagnosis = await prepareKnowledgeDiagnosis({
      config: this.config,
      workspaceRoot,
      question: userMessage,
      persona: caseSession.userPersona,
    });
    if (!diagnosis) {
      return undefined;
    }

    const { route, evidencePack, judge } = diagnosis;
    this.events.knowledgeRouterResult(caseSession, route);
    this.events.knowledgeSearchStarted(caseSession, {
      workspaceRoot,
      query: userMessage,
      moduleCandidates: route.moduleCandidates,
      intentCandidates: route.intentCandidates,
      sourceTypes: route.sourceTypes,
    });
    this.events.knowledgeSearchResult(caseSession, evidencePack);
    this.events.evidenceJudgeStarted(caseSession, evidencePack);
    this.events.evidenceJudgeResult(caseSession, judge);

    if (!judge.answerable || judge.need_code_escalation) {
      attachKnowledgeCodeEscalationContext({
        request,
        question: userMessage,
        route,
        evidencePack,
        judge,
      });
      this.events.codeEscalationRequested(caseSession, request);
      return undefined;
    }

    const result = diagnosticResultFromKnowledge({ evidencePack, judge, route });
    const run: DiagnosticRun = {
      id: request.runId,
      caseId: caseSession.id,
      status: result.status,
      request,
      result,
    };
    this.store.addRun(caseSession, run);
    caseSession.status = caseStatusFromDiagnosticResult(result);
    this.store.saveCase(caseSession);
    this.events.knowledgeAnswerSelected(caseSession, result);
    const review = await this.reviewAndFormat(caseSession, result, run);
    const reply = review.reply;
    this.events.presentationPrepared(caseSession, review.decision);
    this.store.addMessage(caseSession, { role: 'helper', body: reply, replyToMessageId });
    this.events.finalReplyCreated(caseSession, reply, review.decision);
    return { caseSession, assistantMessage: reply, decision: review.decision };
  }

  private workspaceRootFor(workspaceId: string): string | undefined {
    return this.config.workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath;
  }

  private knowledgeWorkspaceRootFor(workspaceId: string): string {
    return resolveKnowledgeWorkspaceRoot(this.config, workspaceId);
  }

  private async modelDrivenPreflight(
    caseSession: StoredCase,
    userMessage: string,
    localDecision: PreflightDecision,
  ): Promise<PreflightDecision | undefined> {
    const workspace = this.config.workspaces.find((item) => item.id === caseSession.workspaceId);
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.inputReviewAgentSpec}

Experience Agent config is loaded separately and runs before this Preflight stage:
${this.experienceAgentSpec}

Return JSON only. Use this shape:
{"action":"ask_user","reason":"...","missingInfo":["..."],"question":"..."}
or
{"action":"dispatch","reason":"...","missingInfo":[]}

Workspace-aware Preflight Rules:
- The current workspace is already selected. Do not ask the user to prove which product, system, project, workspace, documentation, or codebase they mean when a current workspace exists.
- If the user provides business terms, feature names, route/location words, config words, impact questions, or troubleshooting symptoms that can be searched in the current workspace, prefer "dispatch".
- Ask the user only when the missing information blocks the next safe read-only action, such as no workspace, no searchable business/technical signal, or a required customer/runtime selector for a configured MCP lookup.
- For operations, customer, sales, and product users, do not ask for code paths before trying read-only workspace inspection.

Do not include <think>, markdown, comments, explanations, or text outside the JSON object.`,
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            caseId: caseSession.id,
            workspaceId: caseSession.workspaceId,
            workspace: workspace
              ? {
                  id: workspace.id,
                  name: workspace.name,
                  rootPath: workspace.rootPath,
                  mcpToolIds: workspace.mcpToolIds,
                }
              : undefined,
            localPreflightReadiness: summarizePreflightDecision(localDecision),
            messages: caseSession.messages.slice(-8),
            userMessage,
          },
          null,
          2,
        ),
      },
    ], { json: true });

    const parsed = parseAgentModelJson<{
      action?: 'ask_user' | 'dispatch';
      reason?: string;
      missingInfo?: string[];
      question?: string;
    }>(response);

    this.events.modelPreflightResult(caseSession, response, parsed);

    if (parsed.action === 'ask_user') {
      return {
        action: 'ask_user',
        missingInfo: parsed.missingInfo ?? ['关键信息'],
        question: parsed.question ?? '请补充关键信息。如果不清楚，可以直接回复“不清楚”。',
      };
    }

    if (parsed.action === 'dispatch') {
      return {
        action: 'dispatch',
        request: createDiagnosticRequest({
          caseSession,
          userMessage,
          unknowns: parsed.missingInfo ?? [],
          config: this.config,
        }),
      };
    }

    return undefined;
  }

  private reconcilePreflightDecisions(
    caseSession: StoredCase,
    modelDecision: PreflightDecision,
    localDecision: PreflightDecision,
  ): PreflightDecision {
    if (
      modelDecision.action === 'ask_user' &&
      localDecision.action === 'dispatch' &&
      isGenericWorkspaceFollowUp(modelDecision.question, modelDecision.missingInfo)
    ) {
      this.events.modelPreflightOverriddenByLocalDispatch(caseSession, modelDecision, localDecision);
      return localDecision;
    }

    return modelDecision;
  }

  private async reviewAndFormat(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
  ): Promise<{ reply: string; decision: AgentResponse['decision'] }> {
    this.events.evidenceReviewStarted(caseSession, run, result);

    if (this.config.agent.modelProvider) {
      try {
        const modelReview = await this.modelDrivenReview(caseSession, result, run);
        if (modelReview) {
          return modelReview;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.events.modelReviewFailed(caseSession, message);
        return {
          reply: formatReviewFailureFallback(result, caseSession.userPersona, run.request?.userGoal, run.workerTrace, message),
          decision: decisionFromDiagnosticResult(result),
        };
      }
    }

    return {
      reply: ruleBasedReviewAndFormat(result, caseSession.userPersona, run.request?.userGoal),
      decision: decisionFromDiagnosticResult(result),
    };
  }

  private async modelDrivenReview(
    caseSession: StoredCase,
    result: DiagnosticResult,
    run: DiagnosticRun,
  ): Promise<{ reply: string; decision: AgentResponse['decision'] } | undefined> {
    const response = await this.model.complete([
      {
        role: 'system',
        content: `${this.mainAgentSpec}

${this.outputReviewAgentSpec}

${this.presentationAgentSpec}

You are reviewing a Claude Code diagnostic result before the user sees it.
The user-facing persona is: ${caseSession.userPersona} (${personaName(caseSession.userPersona)}).
Return JSON only:
{"outcome":"ask_user|partial|final_answer|escalate_to_human","reply":"Chinese user-facing reply"}

Rules:
- Do not invent facts.
- Reject unsupported facts.
- Keep the main reply concise.
- Mention evidence and unknowns.
- If persona is operations/customer, avoid deep code details in the main reply; translate evidence into product behavior, configuration location, impact, and next action.
- If persona is developer, include code paths only when they are useful evidence.
- If the worker failed or timed out, say the diagnosis is incomplete.
- For final_answer, the reply must include these Chinese sections: 目前判断, 最终解释, 支撑证据.
- In 最终解释, summarize the key supported claims from diagnosticResult.claims instead of only restating the summary.
- Do not include <think>, markdown, comments, explanations, or text outside the JSON object.`,
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            caseId: caseSession.id,
            workspaceId: caseSession.workspaceId,
            latestMessages: caseSession.messages.slice(-8),
            diagnosticRequest: run.request,
            diagnosticResult: result,
            workerTrace: run.workerTrace
              ? {
                  command: run.workerTrace.command,
                  cwd: run.workerTrace.cwd,
                  exitCode: run.workerTrace.exitCode,
                  signal: run.workerTrace.signal,
                  error: run.workerTrace.error,
                }
              : undefined,
          },
          null,
          2,
        ),
      },
    ], { json: true });

    const parsed = parseAgentModelJson<{
      outcome?: 'ask_user' | 'partial' | 'final_answer' | 'escalate_to_human';
      reply?: string;
    }>(response);

    this.events.modelReviewResult(caseSession, response, parsed);

    if (!parsed.reply) {
      return undefined;
    }

    return {
      reply: parsed.reply,
      decision: decisionFromReviewOutcome(parsed.outcome, result),
    };
  }
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 30 ? `${compact.slice(0, 30)}...` : compact || '新的诊断';
}

function isGenericTitle(title: string): boolean {
  return ['新对话', '新的诊断'].includes(title.trim());
}

function findPendingUserMessageId(caseSession: StoredCase, userMessage: string): string | undefined {
  const answered = new Set(
    caseSession.messages
      .filter((message) => message.role === 'helper' && message.replyToMessageId)
      .map((message) => message.replyToMessageId),
  );
  const matching = caseSession.messages.filter((message) => message.role === 'user' && message.body === userMessage);
  return matching.find((message) => !answered.has(message.id))?.id ?? matching.at(-1)?.id;
}
