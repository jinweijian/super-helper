import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../../config.js';
import type { UserPersona } from '../../domain.js';
import type { FileMemoryStore } from '../../storage.js';
import { serializeSession, sessionSummary } from '../dto.js';
import { readJson, sendJson } from '../http-utils.js';

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: SuperHelperConfig,
  store: FileMemoryStore,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    sendJson(res, 200, {
      sessions: store.listCases().map((caseSession) => sessionSummary(caseSession, config)),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = (await readJson(req)) as { title?: string; workspaceId?: string; persona?: UserPersona };
    const workspaceId = body.workspaceId ?? config.workspaces[0]?.id ?? 'current';
    const caseSession = store.createCase({
      tenantId: 'local',
      userId: 'local-user',
      workspaceId,
      title: body.title?.trim() || '新对话',
    });
    caseSession.userPersona = body.persona ?? config.agent.defaultUserPersona;
    store.saveCase(caseSession);
    sendJson(res, 200, { session: serializeSession(caseSession, config) });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    const caseId = url.searchParams.get('caseId');
    if (!caseId) {
      sendJson(res, 400, { error: 'caseId is required' });
      return true;
    }

    const caseSession = store.loadCase(caseId);
    if (!caseSession) {
      sendJson(res, 404, { error: 'session not found' });
      return true;
    }

    sendJson(res, 200, { session: serializeSession(caseSession, config) });
    return true;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/session') {
    const body = (await readJson(req)) as { caseId?: string; action?: 'pin' | 'unpin' | 'archive'; title?: string };
    if (!body.caseId) {
      sendJson(res, 400, { error: 'caseId is required' });
      return true;
    }
    const caseSession = store.loadCase(body.caseId);
    if (!caseSession) {
      sendJson(res, 404, { error: 'session not found' });
      return true;
    }
    if (body.action === 'pin') {
      store.pinCase(caseSession);
    } else if (body.action === 'unpin') {
      store.unpinCase(caseSession);
    } else if (body.action === 'archive') {
      store.archiveCase(caseSession);
    } else if (body.title?.trim()) {
      store.updateTitle(caseSession, body.title.trim());
    } else {
      sendJson(res, 400, { error: 'unsupported session action' });
      return true;
    }
    sendJson(res, 200, { session: serializeSession(caseSession, config) });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/session') {
    const caseId = url.searchParams.get('caseId');
    if (!caseId) {
      sendJson(res, 400, { error: 'caseId is required' });
      return true;
    }
    const deleted = store.deleteCase(caseId);
    if (!deleted) {
      sendJson(res, 404, { error: 'session not found' });
      return true;
    }
    sendJson(res, 200, { deleted: true, caseId });
    return true;
  }

  return false;
}
