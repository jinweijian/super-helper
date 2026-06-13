import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../config.js';
import { ClaudeCodeWorker } from '../claude-worker.js';
import { SuperHelperAgent } from '../agent.js';
import { resolveSessionStorageRoot } from '../sessions/storage-scope.js';
import { FileMemoryStore } from '../storage.js';
import { renderApp } from '../ui.js';
import { sendHtml, sendJson } from './http-utils.js';
import { handleChatRoutes } from './routes/chat-routes.js';
import { handleLogRoutes } from './routes/log-routes.js';
import { handleSessionRoutes } from './routes/session-routes.js';
import { handleSettingsRoutes } from './routes/settings-routes.js';

export interface StartServerOptions {
  config: SuperHelperConfig;
}

export function startServer(options: StartServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const { config } = options;
  const store = new FileMemoryStore(resolveSessionStorageRoot(config));
  const agent = new SuperHelperAgent(config, store, new ClaudeCodeWorker(config));

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, config, store, agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.server.port, config.server.host, () => {
      resolve({
        url: `http://${config.server.host}:${config.server.port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  config: SuperHelperConfig,
  store: FileMemoryStore,
  agent: SuperHelperAgent,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    sendHtml(res, renderApp());
    return;
  }

  if (await handleSettingsRoutes(req, res, url, config)) {
    return;
  }
  if (await handleSessionRoutes(req, res, url, config, store)) {
    return;
  }
  if (await handleChatRoutes(req, res, url, config, agent)) {
    return;
  }
  if (await handleLogRoutes(req, res, url, store)) {
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}
