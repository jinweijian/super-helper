import type { SuperHelperConfig } from '../config.js';
import type { AgentModelClient } from '../model.js';
import type { PreflightDecision } from '../preflight.js';
import type { FileMemoryStore, StoredCase } from '../storage.js';
import { parseAgentModelJson } from './agent-model-review.js';
import { CaseRuntimeEventRecorder } from './event-recorder.js';
import { buildLocalPreflightDecision, isGenericWorkspaceFollowUp, summarizePreflightDecision } from './preflight-gate.js';
import { buildDiagnosticRequest } from './request-builder.js';

export class PreflightService {
  constructor(
    private readonly config: SuperHelperConfig,
    private readonly store: FileMemoryStore,
    private readonly model: AgentModelClient,
    private readonly events: CaseRuntimeEventRecorder,
    private readonly mainAgentSpec: string,
    private readonly inputReviewAgentSpec: string,
    private readonly experienceAgentSpec: string,
  ) {}

  async decide(caseSession: StoredCase, userMessage: string): Promise<PreflightDecision> {
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
          return this.reconcileDecisions(caseSession, modelDecision, localDecision);
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
        request: buildDiagnosticRequest({
          caseSession,
          userMessage,
          unknowns: parsed.missingInfo ?? [],
          config: this.config,
        }),
      };
    }

    return undefined;
  }

  private reconcileDecisions(
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
}
