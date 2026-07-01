import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  configPath,
  defaultConfig,
  ensureConfig,
  loadConfig,
  saveConfig,
  type SuperHelperConfig,
} from '../config.js';
import {
  FileSecretsRepository,
  materializeConfigSecrets,
  migrateLegacyConfigSecrets,
} from '../onboarding/index.js';
import { startServer } from '../gateway/http-server.js';
import { hasFlag, readNumberOption, readOption } from './args.js';
import { resolveServerBinding, type ServerBindMode } from './bindings.js';
import { openBrowser as defaultOpenBrowser } from './open-browser.js';

export interface RunServerCommandInput {
  mode: 'onboard' | 'dashboard';
  argv?: string[];
  write?: (line: string) => void;
  openBrowser?: (url: string) => void;
}

export interface RunDevServerCommandInput {
  argv?: string[];
  write?: (line: string) => void;
}

export async function runServerCommand(input: RunServerCommandInput): Promise<void> {
  const argv = input.argv ?? [];
  const write = input.write ?? ((line: string) => console.log(line));
  const dryRun = hasFlag(argv, '--dry-run');
  const config = loadServerConfig({
    rootDir: readOption(argv, '--home'),
    dryRun,
  });
  applyServerOverrides(config, argv);
  const binding = resolveServerBinding({
    bind: config.server.bindMode,
    host: config.server.host,
    port: config.server.port,
  });
  config.server.host = binding.listenHost;
  config.server.port = binding.port;
  config.server.bindMode = binding.bindMode;

  const targetPath = input.mode === 'onboard' || !config.onboarding.completedAt ? '/setup' : '/';
  const targetUrl = `${binding.localUrl}${targetPath}`;

  write(`mode: ${input.mode}`);
  write(`listen: ${binding.listenHost}:${binding.port}`);
  write(`url: ${targetUrl}`);
  if (binding.warning) {
    write(`warning: ${binding.warning}`);
  }
  if (binding.lanUrls.length > 0) {
    write(`lan: ${binding.lanUrls.join(', ')}`);
  }
  if (dryRun) {
    return;
  }

  const server = await startServer({ config });
  const runtimeUrl = `${server.url}${targetPath}`;
  write(`super helper running at ${runtimeUrl}`);
  write(`config: ${configPath(config.storage.rootDir)}`);
  write('Press Ctrl+C to stop.');

  if (!hasFlag(argv, '--no-open')) {
    try {
      (input.openBrowser ?? defaultOpenBrowser)(runtimeUrl);
    } catch (error) {
      write(`warning: browser open failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const stop = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  await new Promise<void>(() => undefined);
}

export async function runDevServerCommand(input: RunDevServerCommandInput = {}): Promise<void> {
  const argv = input.argv ?? [];
  const write = input.write ?? ((line: string) => console.log(line));
  const config = ensureConfig();
  const portArg = readNumberOption(argv, '--port');
  if (portArg !== undefined) {
    config.server.port = portArg;
  }
  const hostArg = readOption(argv, '--host');
  if (hostArg) {
    config.server.host = hostArg;
  }
  const workspaceArg = readOption(argv, '--workspace');
  if (workspaceArg) {
    config.workspaces[0] = {
      ...config.workspaces[0],
      id: 'current',
      name: 'Current Project',
      rootPath: workspaceArg,
    };
  }

  const server = await startServer({ config });
  write(`super helper running at ${server.url}`);
  write(`config: ${configPath()}`);
  write('Press Ctrl+C to stop.');

  const stop = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  await new Promise<void>(() => undefined);
}

function loadServerConfig(input: {
  rootDir?: string;
  dryRun: boolean;
}): SuperHelperConfig {
  const path = configPath(input.rootDir);
  if (!existsSync(path)) {
    const config = defaultConfig();
    if (input.rootDir) {
      config.storage.rootDir = input.rootDir;
      config.knowledge.rootDir = join(input.rootDir, 'knowledge');
    }
    return config;
  }

  const config = loadConfig(path);
  if (input.dryRun) {
    return config;
  }

  const secrets = new FileSecretsRepository(config.storage.rootDir);
  const migrated = migrateLegacyConfigSecrets(config, secrets);
  saveConfig(migrated);
  return materializeConfigSecrets(migrated, secrets);
}

function applyServerOverrides(config: SuperHelperConfig, argv: string[]): void {
  const bind = readOption(argv, '--bind') as ServerBindMode | undefined;
  if (bind) {
    if (bind !== 'loopback' && bind !== 'lan') {
      throw new Error('Invalid --bind. Expected loopback|lan.');
    }
    config.server.bindMode = bind;
  }

  const host = readOption(argv, '--host');
  if (host) {
    config.server.host = host;
  } else {
    config.server.host = config.server.bindMode === 'lan' ? '0.0.0.0' : '127.0.0.1';
  }

  const port = readNumberOption(argv, '--port');
  if (port !== undefined) {
    config.server.port = port;
  }

  const workspace = readOption(argv, '--workspace');
  if (workspace) {
    config.workspaces[0] = {
      ...config.workspaces[0],
      id: config.workspaces[0]?.id ?? 'current',
      name: config.workspaces[0]?.name ?? 'Current Project',
      rootPath: workspace,
      mcpToolIds: config.workspaces[0]?.mcpToolIds ?? [],
    };
  }
}
