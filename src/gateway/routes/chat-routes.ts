import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveContextWindowTokens, type SuperHelperConfig } from '../../config.js';
import { estimateCaseContextUsage } from '../../context-window.js';
import type { UserPersona } from '../../domain.js';
import type { DiagnosticRuntime } from '../../runtime/diagnostic-runtime.js';
import { readJson, sendJson } from '../http-utils.js';

export async function handleChatRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: SuperHelperConfig,
  agent: DiagnosticRuntime,
): Promise<boolean> {
  if (req.method !== 'POST' || url.pathname !== '/api/chat') {
    return false;
  }

  const body = (await readJson(req)) as {
    caseId?: string;
    message?: string;
    workspaceId?: string;
    persona?: UserPersona;
    async?: boolean;
  };
  if (!body.message?.trim()) {
    sendJson(res, 400, { error: 'message is required' });
    return true;
  }
  if (body.caseId) {
    const existing = agent.loadCase?.(body.caseId);
    if (existing?.archivedAt) {
      sendJson(res, 409, { error: 'session is archived and cannot continue' });
      return true;
    }
  }

  if (body.async) {
    let caseSession;
    try {
      caseSession = agent.startUserTurn({
        caseId: body.caseId,
        message: body.message,
        workspaceId: body.workspaceId,
        persona: body.persona,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/session is archived/i.test(message)) {
        sendJson(res, 409, { error: message });
      } else {
        sendJson(res, 500, { error: 'failed to accept message' });
      }
      return true;
    }
    const userMessageId = caseSession.messages.at(-1)?.id;
    if (!userMessageId) {
      sendJson(res, 500, { error: 'failed to accept message' });
      return true;
    }
    sendJson(res, 202, {
      accepted: true,
      caseId: caseSession.id,
      userMessageId,
      claudeSessionId: caseSession.claudeSessionId,
      title: caseSession.title,
      status: caseSession.status,
      persona: caseSession.userPersona,
      contextUsage: estimateCaseContextUsage(caseSession, resolveContextWindowTokens(config)),
    });
    void agent.completeUserTurn(caseSession.id, body.message).catch((error) => {
      recordBackgroundTurnFailure(agent, caseSession.id, error, userMessageId);
    });
    return true;
  }

  const response = await agent.handleUserMessage({
    caseId: body.caseId,
    message: body.message,
    workspaceId: body.workspaceId,
    persona: body.persona,
  });

  sendJson(res, 200, {
    caseId: response.caseSession.id,
    claudeSessionId: response.caseSession.claudeSessionId,
    title: response.caseSession.title,
    status: response.caseSession.status,
    message: response.assistantMessage,
    decision: response.decision,
    persona: response.caseSession.userPersona,
    contextUsage: estimateCaseContextUsage(response.caseSession, resolveContextWindowTokens(config)),
  });
  return true;
}

function recordBackgroundTurnFailure(
  agent: DiagnosticRuntime,
  caseId: string,
  error: unknown,
  replyToMessageId: string,
): void {
  try {
    agent.recordTurnFailure(caseId, error, replyToMessageId);
  } catch (recordError) {
    // The HTTP response has already been accepted; avoid turning failure recording
    // into an unhandled rejection while preserving the original async contract.
    console.error('background turn failure recording failed', {
      caseId,
      error: recordError instanceof Error ? recordError.message : String(recordError),
    });
  }
}
