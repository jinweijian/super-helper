import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { ensureConfig } from '../dist/config.js';
import { startServer } from '../dist/gateway/http-server.js';
import { FileSecretsRepository } from '../dist/onboarding/secrets.js';
import { createModelClient } from '../dist/providers/model/adapter.js';
import {
  assertAcceptancePollResponse,
  createMonotonicDeadline,
  resolveRealAcceptanceTimeoutMs,
  shouldRetryAcceptancePoll,
} from './acceptance-time.mjs';
import {
  evaluateRealScenario,
  validateRealAcceptanceManifest,
} from './redmine-real-acceptance-contract.mjs';

const args = parseArgs(process.argv.slice(2));
const report = { overall: 'FAIL', prerequisites: [], scenarios: [], audits: [], cleanup: [] };
let server;
const createdCaseIds = [];

try {
  const manifest = loadManifest(args.manifest);
  const workspacePath = requireWorkspace(args.workspace);
  const config = ensureConfig();
  const workspace = config.workspaces.find((item) => item.id === manifest.workspaceId);
  const source = workspace?.historicalCaseSources?.length === 1 ? workspace.historicalCaseSources[0] : undefined;
  const redmine = source ? config.mcpTools.find((item) => item.id === source.serverId) : undefined;
  const secrets = new FileSecretsRepository(config.storage.rootDir);
  const provider = config.agent.modelProvider ? config.models.providers[config.agent.modelProvider] : undefined;

  requireCheck('manifest', Boolean(manifest), 'valid_fixed_three_scenarios');
  requireCheck('workspace', Boolean(workspace && realpathSync(workspace.rootPath) === workspacePath), 'configured_real_workspace');
  requireCheck('workspace_git', isCleanGitWorkspace(workspacePath), 'clean_git_worktree');
  requireCheck('real_model', Boolean(provider && config.agent.useModelForPreflight && providerSecretAvailable(provider, secrets)), 'configured_model_with_secret');
  requireCheck('real_worker', realWorkerAvailable(config), 'configured_claude_worker');
  requireCheck('redmine_source', validRedmineSource(redmine, workspace, secrets), 'production_read_only_stdio_source');
  requireCheck('production_mcp_entry', productionMcpEntry(redmine), 'dist_redmine_main');

  const sourceAudit = auditProductionSource();
  requireCheck('source_get_only', sourceAudit.getOnly, 'redmine_http_get_only');
  requireCheck('source_two_tools', sourceAudit.twoTools, 'exactly_two_read_tools');
  requireCheck('real_model_health', await realModelHealthy(provider, secrets), 'production_model_completion');

  const serverConfig = structuredClone(config);
  serverConfig.server.host = '127.0.0.1';
  serverConfig.server.port = 0;
  server = await startServer({ config: serverConfig });

  for (const scenario of manifest.scenarios) {
    const accepted = await fetch(`${server.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true, persona: 'developer', workspaceId: workspace.id, message: scenario.prompt }),
    });
    const acceptedBody = await accepted.json();
    if (accepted.status !== 202 || typeof acceptedBody.caseId !== 'string') throw new Error('chat_acceptance_failed');
    createdCaseIds.push(acceptedBody.caseId);
    const session = await waitForFormalReply(server.url, acceptedBody.caseId, config.claude.timeoutMs);
    const logResponse = await fetch(`${server.url}/api/logs?caseId=${encodeURIComponent(acceptedBody.caseId)}`);
    if (!logResponse.ok) throw new Error('log_read_failed');
    const logs = await logResponse.json();
    const evaluation = evaluateRealScenario(scenario.id, session, logs);
    const privacy = auditRuntimeArtifacts(session, logs, secretValues(provider, redmine, secrets));
    report.scenarios.push({ ...evaluation, privacyAudit: privacy ? 'PASS' : 'FAIL' });
  }

  report.audits.push({ id: 'runtime_artifact_privacy', status: report.scenarios.every((item) => item.privacyAudit === 'PASS') ? 'PASS' : 'FAIL' });
  report.audits.push({ id: 'redmine_http_methods', status: sourceAudit.getOnly ? 'PASS' : 'FAIL', detail: 'GET_only' });
  report.audits.push({ id: 'redmine_tool_surface', status: sourceAudit.twoTools ? 'PASS' : 'FAIL', detail: 'search_and_detail_only' });
} catch {
  report.audits.push({ id: 'real_runtime', status: 'FAIL', detail: 'bounded_acceptance_failure' });
} finally {
  if (server) {
    for (const caseId of createdCaseIds) {
      try {
        const response = await fetch(`${server.url}/api/session?caseId=${encodeURIComponent(caseId)}`, { method: 'DELETE' });
        report.cleanup.push({ id: 'acceptance_case', status: response.ok ? 'PASS' : 'FAIL' });
      } catch {
        report.cleanup.push({ id: 'acceptance_case', status: 'FAIL' });
      }
    }
    try {
      await server.close();
      report.cleanup.push({ id: 'acceptance_server', status: 'PASS' });
    } catch {
      report.cleanup.push({ id: 'acceptance_server', status: 'FAIL' });
    }
  }
}

report.overall = [
  ...report.prerequisites,
  ...report.scenarios,
  ...report.audits,
  ...report.cleanup,
].length > 0 && [
  ...report.prerequisites,
  ...report.scenarios,
  ...report.audits,
  ...report.cleanup,
].every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL';
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.overall === 'PASS' ? 0 : 2);

function parseArgs(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return { manifest: option('--manifest'), workspace: option('--workspace') };
}

function loadManifest(path) {
  if (!path || !isAbsolute(path) || !existsSync(path) || (statSync(path).mode & 0o077) !== 0) {
    throw new Error('manifest_unavailable');
  }
  return validateRealAcceptanceManifest(JSON.parse(readFileSync(path, 'utf8')));
}

function requireWorkspace(path) {
  if (!path || !isAbsolute(path) || !existsSync(path)) throw new Error('workspace_unavailable');
  return realpathSync(path);
}

function requireCheck(id, passed, detail) {
  report.prerequisites.push({ id, status: passed ? 'PASS' : 'FAIL', detail });
  if (!passed) throw new Error(`prerequisite_${id}`);
}

function isCleanGitWorkspace(path) {
  const inside = spawnSync('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', timeout: 10_000 });
  const status = spawnSync('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8', timeout: 10_000 });
  return inside.status === 0 && inside.stdout.trim() === 'true' && status.status === 0 && status.stdout.trim() === '';
}

function providerSecretAvailable(provider, secrets) {
  return Boolean(provider.apiKey || (provider.apiKeyEnv && process.env[provider.apiKeyEnv]) || secrets.has(provider.apiKeyRef));
}

async function realModelHealthy(provider, secrets) {
  if (!provider) return false;
  const materialized = structuredClone(provider);
  if (!materialized.apiKey && materialized.apiKeyRef) {
    materialized.apiKey = secrets.resolve(materialized.apiKeyRef);
  }
  try {
    const response = await createModelClient(materialized).complete([
      { role: 'system', content: 'Return one JSON object only.' },
      { role: 'user', content: 'Return {"status":"ok"}.' },
    ], { json: true });
    return typeof response === 'string' && response.trim().length > 0;
  } catch {
    return false;
  }
}

function realWorkerAvailable(config) {
  if (!config.claude.enabled || !config.claude.commandWhitelist.includes(config.claude.command)) return false;
  return spawnSync(config.claude.command, ['--version'], { encoding: 'utf8', timeout: 10_000 }).status === 0;
}

function validRedmineSource(serverConfig, workspace, secrets) {
  if (!serverConfig || !workspace || serverConfig.protocol !== 'stdio') return false;
  const ref = serverConfig.config?.env?.REDMINE_API_KEY;
  return serverConfig.enabled && serverConfig.permission === 'read_only' &&
    workspace.mcpToolIds.includes(serverConfig.id) &&
    serverConfig.capability?.type === 'historical_case' && serverConfig.capability.provider === 'redmine' &&
    sameSet(serverConfig.allowedToolNames, ['redmine_search_issues', 'redmine_get_issue_case_details']) &&
    ref?.source === 'file' && ref.key === 'integrations.redmine.apiKey' && secrets.has(ref);
}

function productionMcpEntry(serverConfig) {
  if (!serverConfig || serverConfig.protocol !== 'stdio') return false;
  const expected = resolve(process.cwd(), 'dist', 'mcp-servers', 'redmine', 'main.js');
  return serverConfig.config?.command === process.execPath && serverConfig.config?.args?.length === 1 &&
    resolve(serverConfig.config.args[0]) === expected && existsSync(expected);
}

function auditProductionSource() {
  const client = readFileSync(join(process.cwd(), 'src', 'mcp-servers', 'redmine', 'redmine-api', 'client.ts'), 'utf8');
  const server = readFileSync(join(process.cwd(), 'src', 'mcp-servers', 'redmine', 'server.ts'), 'utf8');
  const registrations = [...server.matchAll(/server\.registerTool\(([^,]+)/g)].map((match) => match[1].trim()).sort();
  return {
    getOnly: /method:\s*['"]GET['"]/.test(client) && !/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(client),
    twoTools: JSON.stringify(registrations) === JSON.stringify(['REDMINE_DETAIL_TOOL_NAME', 'REDMINE_SEARCH_TOOL_NAME']),
  };
}

async function waitForFormalReply(baseUrl, caseId, workerTimeoutMs) {
  const timeoutMs = resolveRealAcceptanceTimeoutMs(workerTimeoutMs, process.env.SUPER_HELPER_REAL_ACCEPTANCE_TIMEOUT_MS);
  const deadline = createMonotonicDeadline(timeoutMs);
  while (!deadline.expired()) {
    try {
      const response = await fetch(`${baseUrl}/api/session?caseId=${encodeURIComponent(caseId)}&includeKnowledgeHealth=false`);
      assertAcceptancePollResponse(response);
      const body = await response.json();
      const session = body.session;
      const run = session?.runs?.at(-1);
      if (run && !['running', 'pending'].includes(run.status) && session.messages?.at(-1)?.role === 'helper') return session;
    } catch (error) {
      if (!shouldRetryAcceptancePoll(error)) throw error;
    }
    await new Promise((done) => setTimeout(done, 1_000));
  }
  throw new Error('acceptance_timeout');
}

function secretValues(provider, redmine, secrets) {
  return [
    provider?.apiKey,
    provider?.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined,
    provider?.apiKeyRef ? secrets.resolve(provider.apiKeyRef) : undefined,
    redmine?.protocol === 'stdio' ? secrets.resolve(redmine.config?.env?.REDMINE_API_KEY) : undefined,
  ].filter((value) => typeof value === 'string' && value.length > 0);
}

function auditRuntimeArtifacts(session, logs, secrets) {
  const serialized = JSON.stringify({ session, logs });
  if (secrets.some((secret) => serialized.includes(secret))) return false;
  const runs = Array.isArray(session?.runs) ? session.runs : [];
  if (runs.some((run) => run.workerTrace && (run.workerTrace.stdout || run.workerTrace.stderr))) return false;
  if (runs.some((run) => run.result?.evidence?.some?.((item) => (
    item.kind === 'mcp' && (!String(item.summary).startsWith('本轮已通过只读 Redmine MCP') || /https?:\/\//i.test(String(item.source)))
  )))) return false;
  const forbiddenKeys = new Set(['query', 'signals', 'body', 'identity', 'url', 'key', 'reason', 'plan', 'error']);
  const caseEvents = (logs?.blocks ?? []).filter((item) => /^(historical_case|current_project_verification)/.test(item.phase));
  return caseEvents.every((item) => !containsForbiddenKey(item.detail, forbiddenKeys));
}

function containsForbiddenKey(value, forbiddenKeys) {
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item, forbiddenKeys));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => forbiddenKeys.has(key.toLowerCase()) || containsForbiddenKey(item, forbiddenKeys));
}

function sameSet(left, right) {
  return Array.isArray(left) && left.length === right.length && right.every((item) => left.includes(item));
}
