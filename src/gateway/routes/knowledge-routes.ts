import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../../config.js';
import {
  buildKnowledgeHealthSummary,
  initKnowledgeWorkspace,
  resolveKnowledgeWorkspaceRoot,
  updateKnowledgeIndexWithQuality,
} from '../../knowledge/index.js';
import { readJson, sendJson } from '../http-utils.js';

type KnowledgeActionBody = {
  workspaceId?: string;
  query?: string;
};

export async function handleKnowledgeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: SuperHelperConfig,
): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/knowledge/health') {
    const workspaceId = resolveWorkspaceId(config, url.searchParams.get('workspaceId') ?? undefined);
    if (!workspaceId) {
      sendJson(res, 400, { error: 'workspaceId is required' });
      return true;
    }

    sendJson(res, 200, {
      ok: true,
      workspaceId,
      knowledgeHealth: buildKnowledgeHealthSummary({
        config,
        workspaceId,
        query: url.searchParams.get('query') ?? undefined,
      }),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/bind') {
    const body = (await readJson(req)) as KnowledgeActionBody;
    const workspaceId = resolveWorkspaceId(config, body.workspaceId);
    if (!workspaceId) {
      sendJson(res, 400, { error: 'workspaceId is required' });
      return true;
    }

    const knowledgeWorkspaceRoot = resolveKnowledgeWorkspaceRoot(config, workspaceId);
    const init = initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspaceRoot });
    sendJson(res, 200, {
      ok: true,
      workspaceId,
      init,
      knowledgeHealth: buildKnowledgeHealthSummary({
        config,
        workspaceId,
        query: body.query,
      }),
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/knowledge/reindex') {
    const body = (await readJson(req)) as KnowledgeActionBody;
    const workspaceId = resolveWorkspaceId(config, body.workspaceId);
    if (!workspaceId) {
      sendJson(res, 400, { error: 'workspaceId is required' });
      return true;
    }

    const knowledgeWorkspaceRoot = resolveKnowledgeWorkspaceRoot(config, workspaceId);
    initKnowledgeWorkspace({ workspaceRoot: knowledgeWorkspaceRoot });
    const update = updateKnowledgeIndexWithQuality({ workspaceRoot: knowledgeWorkspaceRoot });
    sendJson(res, 200, {
      ok: true,
      workspaceId,
      update,
      knowledgeHealth: buildKnowledgeHealthSummary({
        config,
        workspaceId,
        query: body.query,
      }),
    });
    return true;
  }

  return false;
}

function resolveWorkspaceId(config: SuperHelperConfig, workspaceId?: string): string | undefined {
  const requested = workspaceId?.trim() || config.workspaces[0]?.id;
  if (!requested) {
    return undefined;
  }
  return config.workspaces.some((workspace) => workspace.id === requested) ? requested : undefined;
}
