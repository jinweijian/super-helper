import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand, runCommandWithSessionBusyRetry } from '../dist/workers/claude/claude-cli.js';
import { validateInvestigationProfiles } from '../dist/config/investigation-profiles.js';

test('配置拒绝未校准值并剔除额外字段', () => {
  assert.throws(() => validateInvestigationProfiles({ enabled: true }), /需要/);
  assert.throws(() => validateInvestigationProfiles({ enabled: true, fast: { model: 'f', effort: 'low', maxTurns: 0 }, deep: { model: 'd', effort: 'high', timeoutMs: 12 } }), /正整数/);
});

test('忽略 SIGTERM 的子进程在宽限后被 SIGKILL', async () => {
  const controller = new AbortController();
  const result = await runCommand(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); console.log(JSON.stringify({type:"result",subtype:"success",result:"ready"})); setInterval(()=>{},1000)'], process.cwd(), 3000,
    { streamJson: true, terminationGraceMs: 30, signal: controller.signal, onProgress: () => controller.abort() });
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.error, 'Worker cancelled');
});

test('session busy 等待期间取消不等待重试延迟', async () => {
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 80);
  const result = await runCommandWithSessionBusyRetry(process.execPath, ['-e', 'console.error("Session ID abc is already in use");process.exit(1)'], process.cwd(), 1000, 3, 10000, { signal: controller.signal });
  assert.equal(result.error, 'Worker cancelled');
  assert.ok(Date.now() - started < 1000);
});
import { defaultConfig, saveConfig, loadConfig } from '../dist/config.js';
import { ClaudeCodeWorker } from '../dist/workers/claude/claude-code-worker.js';

test('profiles 配置 round-trip 与旧缺省兼容', () => {
  const dir = mkdtempSync(join(tmpdir(), 'investigation-config-'));
  try {
    const config = defaultConfig();
    const path = join(dir, 'config.json');
    saveConfig(config, path);
    assert.equal(loadConfig(path).claude.investigationProfiles, undefined);
    config.claude.investigationProfiles = { enabled: true, fast: { model: 'f', effort: 'low', maxTurns: 7 }, deep: { model: 'd', effort: 'high', timeoutMs: 1200000 } };
    saveConfig(config, path);
    assert.deepEqual(loadConfig(path).claude.investigationProfiles, config.claude.investigationProfiles);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Fast 参数使用明确 profile 且旧配置保持兼容', async () => {
  const config = defaultConfig();
  config.claude.enabled = true;
  config.claude.command = '/bin/echo';
  config.claude.commandWhitelist = ['/bin/echo'];
  config.workspaces = [{ id: 'w', rootPath: process.cwd(), mcpToolIds: [] }];
  config.claude.investigationProfiles = { enabled: true, fast: { model: 'test-fast', effort: 'low', maxTurns: 7 }, deep: { model: 'test-deep', effort: 'high', timeoutMs: 1200000 } };
  const request = { workspaceId: 'w', claudeSessionId: 's', runId: 'run_01', unknowns: [], context: {}, investigation: { requestedMode: 'fast', resolvedProfile: 'fast', attempt: 1, escalationAllowed: false } };
  const response = await new ClaudeCodeWorker(config).diagnose(request);
  assert.match(response.trace.command, /--model test-fast --effort low --prompt-suggestions false --max-turns 7/);
  delete request.investigation;
  assert.doesNotMatch((await new ClaudeCodeWorker(config).diagnose(request)).trace.command, /--model|--max-turns/);
});

test('取消在启动前生效', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runCommand(process.execPath, ['-e', 'console.log("started")'], process.cwd(), 1000, { signal: controller.signal });
  assert.equal(result.stdout, '');
  assert.equal(result.error, 'Worker cancelled');
});

test('流事件只保留最终结果与白名单进度', async () => {
  const progress = [];
  const events = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: '1', name: 'Grep', input: { pattern: 'SECRET' } }, { type: 'tool_use', id: '2', name: 'Read', input: { file_path: 'package.json' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: '3', name: 'Read', input: { file_path: '../private' } }] } },
    { type: 'result', subtype: 'success', result: '{"status":"partial"}' },
  ];
  const result = await runCommand(process.execPath, ['-e', `for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event))`], process.cwd(), 1000, { streamJson: true, onProgress: item => progress.push(item) });
  assert.equal(JSON.parse(result.stdout).type, 'result');
  assert.equal(result.stdout.includes('SECRET'), false);
  assert.equal(progress.at(-1).filesRead, 1);
  assert.equal(progress.at(-1).searchCount, 1);
  assert.deepEqual(Object.keys(progress.at(-1)).sort(), ['filesRead', 'lastActivityAt', 'searchCount', 'stage']);
});

test('真实 Worker Deep 路径与排队取消保持会话串行', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'investigation-worker-'));
  try {
    const command = join(dir, 'fake-claude');
    writeFileSync(command, `#!/usr/bin/env node
if(process.argv.includes('--max-turns')) {
  if (!process.argv.some(arg=>arg.includes('Expand the search scope at most once'))) process.exit(2);
  console.log(JSON.stringify({type:'result',subtype:'error_max_turns',errors:['SECRET']})); process.exit(1);
}
if (!process.argv.some(arg=>arg.includes('counterevidence'))) process.exit(2);
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'read',name:'Read',input:{file_path:'package.json',secret:'SECRET'}}]}}));
setTimeout(()=>console.log(JSON.stringify({type:'result',subtype:'success',result:JSON.stringify({status:'partial',summary:'安全结果',missingInfo:[],evidence:[],claims:[],recommendedNextAction:'ask_user'})})),150);
`);
    chmodSync(command, 0o755);
    const config = defaultConfig();
    config.claude.enabled = true;
    config.claude.command = command;
    config.claude.commandWhitelist = [command];
    config.workspaces = [{ id: 'w', rootPath: process.cwd(), mcpToolIds: [] }];
    config.claude.investigationProfiles = { enabled: true, fast: { model: 'f', effort: 'low', maxTurns: 7 }, deep: { model: 'd', effort: 'high', timeoutMs: 1200000 } };
    const request = { workspaceId: 'w', claudeSessionId: 'queue-test', runId: 'run_01', unknowns: [], investigation: { requestedMode: 'deep', resolvedProfile: 'deep', attempt: 1, escalationAllowed: false } };
    const worker = new ClaudeCodeWorker(config);
    let started;
    const active = new Promise(resolve => { started = resolve; });
    const first = worker.diagnose(request, { onProgress: started });
    await active;
    const cancel = new AbortController();
    const queued = worker.diagnose(request, { signal: cancel.signal });
    cancel.abort();
    assert.equal((await queued).trace.error, 'Worker cancelled');
    let firstFinished = false;
    void first.then(() => { firstFinished = true; });
    let overlap = false;
    const third = worker.diagnose(request, { onProgress: () => { overlap ||= !firstFinished; } });
    const response = await first;
    assert.match(response.trace.command, /--output-format stream-json/);
    assert.match(response.trace.command, /--verbose/);
    assert.doesNotMatch(response.trace.command, /--max-turns/);
    assert.equal(response.trace.stdout, '');
    assert.equal(response.trace.stderr, '');
    assert.doesNotMatch(response.trace.command, /--system-prompt|DiagnosticRequest|unknowns/);
    assert.equal(response.result.summary, '安全结果');
    await third;
    assert.equal(overlap, false);
    request.investigation.resolvedProfile = 'fast';
    const bounded = await worker.diagnose(request);
    assert.equal(bounded.result.status, 'partial');
    assert.match(bounded.result.summary, /error_max_turns/);
    assert.equal(JSON.stringify(bounded).includes('SECRET'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
