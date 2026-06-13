import type { SuperHelperConfig } from '../config.js';
import type { DiagnosticRequest, DiagnosticResult } from '../domain.js';
import { buildDiagnosticRequestContext } from '../sessions/context-builder.js';
import type { StoredCase } from '../storage.js';

export function buildDiagnosticRequest(input: {
  caseSession: StoredCase;
  userMessage: string;
  unknowns: string[];
  config: SuperHelperConfig;
}): DiagnosticRequest {
  const { caseSession, userMessage, unknowns, config } = input;
  const latestRunNumber = caseSession.runs.length + 1;
  const knownFacts = Array.from(
    new Set(
      caseSession.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.body.trim())
        .filter(Boolean),
    ),
  );

  const request: DiagnosticRequest = {
    caseId: caseSession.id,
    runId: `run_${String(latestRunNumber).padStart(2, '0')}`,
    workspaceId: caseSession.workspaceId,
    claudeSessionId: caseSession.claudeSessionId,
    userGoal: userMessage,
    knownFacts,
    unknowns,
    constraints: [
      'Claude Code is an inspection tool and must not respond directly to the user.',
      `User-facing persona is ${caseSession.userPersona}; return evidence for super helper Agent to translate.`,
      'Handle both troubleshooting requests and general project questions.',
      'Return structured evidence, assumptions, missing information, and recommended next action.',
      'Do not make final claims without evidence.',
    ],
    allowedMcpToolIds: config.workspaces.find((workspace) => workspace.id === caseSession.workspaceId)?.mcpToolIds ?? [],
    userPersona: caseSession.userPersona,
  };
  attachCaseContext(caseSession, request);
  return request;
}

export function buildFollowUpDiagnosticRequest(input: {
  caseSession: StoredCase;
  previousRequest: DiagnosticRequest;
  previousResult: DiagnosticResult;
}): DiagnosticRequest {
  const { caseSession, previousRequest, previousResult } = input;
  const latestRunNumber = caseSession.runs.length + 1;
  const evidenceSummaries = previousResult.evidence.map((item) => `${item.id}: ${item.summary} (${item.source})`);
  const claimSummaries = previousResult.claims.map((claim) => `${claim.type}: ${claim.text}`);

  const request: DiagnosticRequest = {
    ...previousRequest,
    runId: `run_${String(latestRunNumber).padStart(2, '0')}`,
    userGoal: `继续追查上一轮未完成的问题：${previousRequest.userGoal}`,
    knownFacts: Array.from(new Set([...previousRequest.knownFacts, previousResult.summary, ...evidenceSummaries, ...claimSummaries])),
    unknowns: previousResult.missingInfo,
    constraints: [
      ...previousRequest.constraints,
      'This is a follow-up run in the same Claude session; reuse earlier context and focus only on the missing evidence.',
    ],
    userPersona: caseSession.userPersona,
  };
  attachCaseContext(caseSession, request);
  return request;
}

export function attachCaseContext(caseSession: StoredCase, request: DiagnosticRequest): void {
  const context = buildDiagnosticRequestContext(caseSession, request.userGoal);
  request.context = context;
  if (context.isFollowUp) {
    request.constraints = Array.from(
      new Set([
        ...request.constraints,
        'Resolve follow-up references such as "刚刚", "上一轮", "这个设置", "那个页面", or "the previous answer" using DiagnosticRequest.context.recentMessages and DiagnosticRequest.context.previousRuns.',
        'Answer the latest userGoal first. Do not repeat a previous answer unless it is needed to ground the follow-up.',
      ]),
    );
  }
}
