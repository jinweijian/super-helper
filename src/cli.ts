#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { configPath, ensureConfig, saveConfig } from './config.js';
import { startServer } from './server.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'dev';

  if (command === 'init') {
    const path = configPath();
    const config = ensureConfig();
    saveConfig(config);
    console.log(`supper helper config ready at ${path}`);
    return;
  }

  if (command === 'doctor') {
    const config = ensureConfig();
    console.log(`config: ${configPath()}`);
    console.log(`storage: ${config.storage.rootDir}`);
    const claude = spawnSync(config.claude.command, ['--version'], { encoding: 'utf8' });
    console.log(`claude: ${claude.status === 0 ? claude.stdout.trim() : 'not available'}`);
    console.log(`AGENT.md: ${existsSync('AGENT.md') ? 'present' : 'missing'}`);
    return;
  }

  if (command === 'model' && process.argv[3] === 'set') {
    const name = process.argv[4] ?? 'default';
    const baseUrl = readArg('--base-url');
    const model = readArg('--model');
    const apiKey = readArg('--api-key');
    const apiKeyEnv = readArg('--api-key-env');
    if (!baseUrl || !model || (!apiKey && !apiKeyEnv)) {
      console.error('Usage: supper-helper model set <name> --base-url <url> --model <model> (--api-key-env <env> | --api-key <key>)');
      process.exit(1);
    }

    const config = ensureConfig();
    config.models.providers[name] = {
      type: 'openai-compatible',
      baseUrl,
      model,
      apiKey,
      apiKeyEnv,
      temperature: 0,
    };
    config.agent.modelProvider = name;
    config.agent.useModelForPreflight = true;
    saveConfig(config);
    console.log(`agent model provider "${name}" configured`);
    return;
  }

  if (command === 'workspace' && process.argv[3] === 'set') {
    const rootPath = readArg('--path');
    if (!rootPath) {
      console.error('Usage: supper-helper workspace set --path <project-path> [--name <name>]');
      process.exit(1);
    }

    const config = ensureConfig();
    config.workspaces[0] = {
      id: 'current',
      name: readArg('--name') ?? 'Current Project',
      rootPath,
      mcpToolIds: config.workspaces[0]?.mcpToolIds ?? [],
    };
    saveConfig(config);
    console.log(`workspace configured: ${rootPath}`);
    return;
  }

  if (command === 'mcp' && process.argv[3] === 'add') {
    const id = process.argv[4];
    const protocol = readArg('--protocol') as 'stdio' | 'http' | 'sse' | undefined;
    if (!id || !protocol || !['stdio', 'http', 'sse'].includes(protocol)) {
      console.error('Usage: supper-helper mcp add <id> --protocol <stdio|http|sse> [--name <name>] [--permission read_only|read_write] [--config-json <json>]');
      process.exit(1);
    }

    const config = ensureConfig();
    const tool = {
      id,
      name: readArg('--name') ?? id,
      protocol,
      permission: (readArg('--permission') as 'read_only' | 'read_write' | undefined) ?? 'read_only',
      enabled: true,
      config: readJsonArg('--config-json'),
    };
    config.mcpTools = config.mcpTools.filter((item) => item.id !== id).concat(tool);
    config.workspaces[0] = {
      ...config.workspaces[0],
      mcpToolIds: Array.from(new Set([...(config.workspaces[0]?.mcpToolIds ?? []), id])),
    };
    saveConfig(config);
    console.log(`MCP tool configured: ${id}`);
    return;
  }

  if (command === 'dev' || command === 'serve') {
    const config = ensureConfig();
    const portArg = readArg('--port');
    if (portArg) {
      config.server.port = Number(portArg);
    }
    const hostArg = readArg('--host');
    if (hostArg) {
      config.server.host = hostArg;
    }
    const workspaceArg = readArg('--workspace');
    if (workspaceArg) {
      config.workspaces[0] = {
        ...config.workspaces[0],
        id: 'current',
        name: 'Current Project',
        rootPath: workspaceArg,
      };
    }

    const server = await startServer({ config });
    console.log(`supper helper running at ${server.url}`);
    console.log(`config: ${configPath()}`);
    console.log('Press Ctrl+C to stop.');

    const stop = async (): Promise<void> => {
      await server.close();
      process.exit(0);
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
    await new Promise<void>(() => undefined);
  }

  console.error(`Unknown command: ${command}`);
  console.error('Usage: supper-helper [init|doctor|dev|model set|workspace set|mcp add]');
  process.exit(1);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function readJsonArg(name: string): unknown {
  const value = readArg(name);
  if (!value) {
    return undefined;
  }

  return JSON.parse(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
