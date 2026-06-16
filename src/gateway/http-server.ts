import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SuperHelperConfig } from '../config.js';
import { FileSecretsRepository, createOnboardingService, materializeConfigSecrets, type OnboardingService } from '../onboarding/index.js';
import { renderSetupApp } from '../setup-ui.js';
import { renderApp } from '../ui.js';
import { sendHtml, sendJson, sendRedirect } from './http-utils.js';
import { GatewayApplicationContext } from './application-context.js';
import { handleChatRoutes } from './routes/chat-routes.js';
import { handleKnowledgeRoutes } from './routes/knowledge-routes.js';
import { handleLogRoutes } from './routes/log-routes.js';
import { handleOnboardingRoutes } from './routes/onboarding-routes.js';
import { handleSessionRoutes } from './routes/session-routes.js';
import { handleSettingsRoutes } from './routes/settings-routes.js';

export interface StartServerOptions {
  config: SuperHelperConfig;
  onboarding?: OnboardingService;
}

export function startServer(options: StartServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const context = new GatewayApplicationContext(options.config);
  const secrets = new FileSecretsRepository(options.config.storage.rootDir);
  const onboarding = options.onboarding ?? createOnboardingService({
    config: options.config,
    onConfigCommitted: (config) => context.reload(materializeConfigSecrets(config, secrets)),
  });

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, context, onboarding);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.config.server.port, options.config.server.host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : options.config.server.port;
      const host = options.config.server.host === '0.0.0.0' ? '127.0.0.1' : options.config.server.host;
      resolve({
        url: `http://${host}:${actualPort}`,
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
  context: GatewayApplicationContext,
  onboarding: OnboardingService,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const { config, store, agent } = context;

  if (req.method === 'GET' && url.pathname === '/setup') {
    sendHtml(res, renderSetupApp());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    if (!onboarding.getState().completed) {
      sendRedirect(res, '/setup');
      return;
    }
    sendHtml(res, renderApp());
    return;
  }

  if (await handleOnboardingRoutes(req, res, url, onboarding)) {
    return;
  }
  if (await handleSettingsRoutes(req, res, url, config)) {
    return;
  }
  if (await handleSessionRoutes(req, res, url, config, store)) {
    return;
  }
  if (await handleKnowledgeRoutes(req, res, url, config)) {
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
