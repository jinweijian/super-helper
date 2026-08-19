import { DEFAULT_HOME } from '../config/defaults.js';
import { configPath, ensureConfig, saveConfig } from '../config.js';
import { runRedmineReadonlyProbe } from '../mcp-servers/redmine/probe.js';
import type { McpServerConfig } from '../mcp/contracts.js';
import { FileSecretsRepository } from '../onboarding/secrets.js';
import { readHiddenLine } from './hidden-input.js';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export const REDMINE_API_KEY_SECRET = 'integrations.redmine.apiKey';

export interface RunRedmineCommandInput {
  argv: string[];
  rootDir?: string;
  readSecret?: (prompt: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  probe?: typeof runRedmineReadonlyProbe;
  write?: (line: string) => void;
  mcpEntryPath?: string;
}

export async function runRedmineCommand(input: RunRedmineCommandInput): Promise<boolean> {
  const write = input.write ?? ((line: string) => console.log(line));
  if (input.argv.length === 1 && input.argv[0] === 'probe') {
    return runProbe(input, write);
  }
  if (input.argv.length === 2 && input.argv[0] === 'secret' && input.argv[1] === 'set') {
    return setSecret(input, write);
  }
  if (input.argv.length === 2 && input.argv[0] === 'source' && input.argv[1] === 'enable') {
    return configureHistoricalSource(input, write, true);
  }
  if (input.argv.length === 2 && input.argv[0] === 'source' && input.argv[1] === 'disable') {
    return configureHistoricalSource(input, write, false);
  }
  write('用法: super-helper redmine <secret set|probe|source enable|source disable>');
  return false;
}

function configureHistoricalSource(
  input: RunRedmineCommandInput,
  write: (line: string) => void,
  enabled: boolean,
): boolean {
  const rootDir = input.rootDir ?? DEFAULT_HOME;
  const config = ensureConfig(rootDir);
  const workspace = config.workspaces[0];
  if (!workspace) {
    write('redmine historical source: failed (workspace_missing)');
    return false;
  }
  if (!enabled) {
    workspace.historicalCaseSources = undefined;
    workspace.mcpToolIds = workspace.mcpToolIds.filter((id) => id !== 'company-redmine');
    const usedElsewhere = config.workspaces.slice(1).some((item) => (
      item.mcpToolIds.includes('company-redmine') ||
      item.historicalCaseSources?.some((source) => source.serverId === 'company-redmine')
    ));
    if (!usedElsewhere) config.mcpTools = config.mcpTools.filter((item) => item.id !== 'company-redmine');
    saveConfig(config, configPath(rootDir));
    write('redmine historical source: disabled');
    return true;
  }

  const entryPath = input.mcpEntryPath ?? fileURLToPath(new URL('../mcp-servers/redmine/main.js', import.meta.url));
  const server: McpServerConfig = {
    id: 'company-redmine',
    name: 'Company Redmine',
    protocol: 'stdio',
    permission: 'read_only',
    enabled: true,
    allowedToolNames: ['redmine_search_issues', 'redmine_get_issue_case_details'],
    capability: { type: 'historical_case', provider: 'redmine' },
    timeoutMs: 30_000,
    config: {
      command: process.execPath,
      args: [entryPath],
      env: { REDMINE_API_KEY: { source: 'file', key: REDMINE_API_KEY_SECRET } },
    },
  };
  config.mcpTools = config.mcpTools.filter((item) => item.id !== server.id).concat(server);
  workspace.mcpToolIds = Array.from(new Set([...workspace.mcpToolIds, server.id]));
  workspace.historicalCaseSources = [{ serverId: server.id }];
  config.claude.commandWhitelist = Array.from(new Set([...config.claude.commandWhitelist, process.execPath]));
  saveConfig(config, configPath(rootDir));
  write('redmine historical source: enabled');
  return true;
}

async function setSecret(
  input: RunRedmineCommandInput,
  write: (line: string) => void,
): Promise<boolean> {
  const readSecret = input.readSecret ?? readHiddenLine;
  let first: string;
  let second: string;
  try {
    first = (await readSecret('Redmine API 访问键: ')).trim();
    if (!first) {
      write('redmine secret: failed (empty_secret)');
      return false;
    }
    second = (await readSecret('再次输入 Redmine API 访问键: ')).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = message === 'interactive_tty_required' || message === 'input_cancelled'
      ? message
      : 'secret_input_failed';
    write(`redmine secret: failed (${code})`);
    return false;
  }

  if (first !== second) {
    write('redmine secret: failed (confirmation_mismatch)');
    return false;
  }

  new FileSecretsRepository(input.rootDir ?? DEFAULT_HOME).set(REDMINE_API_KEY_SECRET, first);
  write('redmine secret: configured');
  return true;
}

async function runProbe(
  input: RunRedmineCommandInput,
  write: (line: string) => void,
): Promise<boolean> {
  const secrets = new FileSecretsRepository(input.rootDir ?? DEFAULT_HOME);
  const apiKey = secrets.resolve({ source: 'file', key: REDMINE_API_KEY_SECRET });
  if (!apiKey) {
    write('redmine readonly probe: failed (missing_credentials)');
    write('请先执行: super-helper redmine secret set');
    return false;
  }

  const result = await (input.probe ?? runRedmineReadonlyProbe)({
    apiKey,
    fetchImpl: input.fetchImpl,
  });
  if (!result.ok) {
    write(`redmine readonly probe: failed (${result.code})`);
    return false;
  }

  write('redmine authentication: ok');
  write(`redmine project: ok (identifier=${result.project.identifier}, numericId=${result.project.numericId})`);
  write(`redmine issue list: ok (sampleCount=${result.issueList.sampleCount}, includesAllStatuses=true)`);
  if (result.issueDetail.status === 'ok') {
    write(`redmine issue detail: ok (journals=${result.issueDetail.journalCount}, relations=${result.issueDetail.relationCount}, attachments=${result.issueDetail.attachmentCount})`);
  } else {
    write('redmine issue detail: skipped (no_issue)');
  }
  write('redmine readonly probe: passed');
  return true;
}
