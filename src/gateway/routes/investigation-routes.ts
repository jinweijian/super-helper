import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DiagnosticRuntime } from '../../runtime/diagnostic-runtime.js';
import { readJson, sendJson } from '../http-utils.js';
import { requireCaseId } from '../request-contracts.js';

export async function handleInvestigationRoutes(req: IncomingMessage, res: ServerResponse, url: URL, runtime: DiagnosticRuntime): Promise<boolean> {
  const progress = req.method === 'GET' && url.pathname === '/api/chat/progress';
  const cancel = req.method === 'POST' && url.pathname === '/api/chat/cancel';
  if (!progress && !cancel) return false;
  const input = progress
    ? {caseId: url.searchParams.get('caseId'), userMessageId: url.searchParams.get('userMessageId')}
    : await readJson(req) as {caseId?: unknown; userMessageId?: unknown};
  if (!input || typeof input.caseId !== 'string' || typeof input.userMessageId !== 'string' || !input.userMessageId || input.userMessageId.length > 128) {
    sendJson(res, 400, {error: 'caseId and userMessageId are required'});
    return true;
  }
  const caseId = requireCaseId(input.caseId);
  if (!runtime.loadCase(caseId)) {
    sendJson(res, 404, {error: 'case not found'});
    return true;
  }
  if (progress) sendJson(res, 200, {progress: runtime.investigationProgress(caseId, input.userMessageId) ?? null});
  else {
    const accepted = runtime.cancelInvestigation(caseId, input.userMessageId);
    sendJson(res, accepted ? 202 : 409, accepted ? {accepted: true} : {error: 'turn is not active'});
  }
  return true;
}
