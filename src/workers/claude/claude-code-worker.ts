import type { SuperHelperConfig } from '../../config.js';
import type { ClaudeWorkerResponse, DiagnosticRequest, WorkerTrace } from '../../domain.js';
import type { DiagnosticWorker, DiagnosticWorkerOptions } from '../diagnostic-worker.js';
import { runCommandWithSessionBusyRetry, shellCommand } from './claude-cli.js';
import { failedExecutionDiagnosticResult, mockDiagnosticResponse, parseClaudeOutput } from './claude-output-parser.js';
import { buildClaudeSystemPrompt, buildClaudeUserPrompt } from './claude-prompts.js';
import { assertHostCommandAllowed, DEFAULT_DISALLOWED_CLAUDE_TOOLS, readOnlyTools } from './claude-policy.js';
import { currentWorkerCoverageEvidence } from './coverage-evidence.js';

export class ClaudeCodeWorker implements DiagnosticWorker {
  private static readonly sessionQueues = new Map<string, Promise<void>>();

  constructor(private readonly config: SuperHelperConfig) {}

  async diagnose(request: DiagnosticRequest, options: DiagnosticWorkerOptions = {}): Promise<ClaudeWorkerResponse> {
    return this.withSessionLock(request, options);
  }

  private async diagnoseUnlocked(request: DiagnosticRequest, options: DiagnosticWorkerOptions): Promise<ClaudeWorkerResponse> {
    const startedAt = new Date().toISOString();
    if (options.signal?.aborted) return mockDiagnosticResponse(request, 'Worker cancelled', startedAt);
    if (!this.config.claude.enabled) {
      return mockDiagnosticResponse(request, 'Claude Code worker disabled in config.', startedAt);
    }

    const workspace = this.config.workspaces.find((item) => item.id === request.workspaceId);
    if (!workspace) {
      return mockDiagnosticResponse(request, `Workspace ${request.workspaceId} not found.`, startedAt);
    }

    const commandAllowed = assertHostCommandAllowed(this.config.claude.command, this.config.claude.commandWhitelist);
    if (commandAllowed) {
      return mockDiagnosticResponse(request, commandAllowed, startedAt);
    }

    const profiles = this.config.claude.investigationProfiles;
    const mode = request.investigation?.resolvedProfile;
    const profile = mode === 'fast' ? profiles?.fast : mode === 'deep' ? profiles?.deep : undefined;
    const effort = profile?.effort ?? (mode === 'deep' ? 'high' : 'low');
    const systemPrompt = buildClaudeSystemPrompt(mode);
    const userPrompt = buildClaudeUserPrompt(request);
    const allowedTools = readOnlyTools(this.config.claude.allowedTools ?? this.config.claude.tools);
    const disallowedTools = Array.from(
      new Set([...(this.config.claude.disallowedTools ?? DEFAULT_DISALLOWED_CLAUDE_TOOLS), ...DEFAULT_DISALLOWED_CLAUDE_TOOLS]),
    );
    const args = [
      '-p',
      '--output-format',
      mode === 'deep' ? 'stream-json' : 'json',
      ...(mode ? [...(profile?.model ? ['--model', profile.model] : []), '--effort', effort, '--prompt-suggestions', 'false'] : []),
      ...(mode === 'deep' ? ['--verbose'] : []),
      '--permission-mode',
      this.config.claude.permissionMode,
      '--tools',
      allowedTools.join(','),
      '--allowedTools',
      allowedTools.join(','),
      '--disallowedTools',
      disallowedTools.join(' '),
      '--system-prompt',
      systemPrompt,
      ...sessionArgs(request),
      userPrompt,
    ];
    const maxBudgetUsd = this.config.claude.maxBudgetUsd;
    if (Number.isFinite(maxBudgetUsd) && Number(maxBudgetUsd) > 0) {
      args.splice(3, 0, '--max-budget-usd', String(maxBudgetUsd));
    }
    const command = shellCommand(this.config.claude.command, args);

    // 有明确排查模式时，不以时间截断权威方；模式边界由 prompt/max-turns 控制，
    // 用户停止仍通过 AbortSignal 终止进程。未带模式的旧调用保留原超时兼容行为。
    const timeoutMs = mode ? 0 : this.config.claude.timeoutMs;
    const execution = await runCommandWithSessionBusyRetry(
      this.config.claude.command,
      args,
      workspace.rootPath,
      timeoutMs,
      this.config.claude.sessionBusyMaxRetries ?? 3,
      this.config.claude.sessionBusyRetryDelayMs ?? 3_000,
      { ...options, streamJson: mode === 'deep' },
    );
    const trace: WorkerTrace = {
      command: mode ? shellCommand('claude', args.slice(0, args.indexOf('--system-prompt'))) : command,
      cwd: mode ? '' : workspace.rootPath,
      stdout: mode ? '' : execution.stdout,
      stderr: mode ? '' : execution.stderr,
      exitCode: execution.exitCode,
      signal: execution.signal,
      error: mode && execution.error ? (options.signal?.aborted ? 'Worker cancelled' : 'Claude Code execution failed') : execution.error,
      startedAt,
      finishedAt: new Date().toISOString(),
    };

    if (mode === 'fast' && !execution.signal && !options.signal?.aborted && isMaxTurns(execution.stdout)) {
      return { result: parseClaudeOutput('{"type":"result","subtype":"error_max_turns"}', request, { omitRawOutput: true }),
        trace: { ...trace, error: undefined, exitCode: 0 } };
    }
    if (execution.exitCode !== 0 || execution.signal || execution.error) {
      return {
        result: failedExecutionDiagnosticResult(request, mode ? {
          ...execution, stdout: '', stderr: '',
          error: options.signal?.aborted ? 'Worker cancelled' : 'Claude Code execution failed',
        } : execution),
        trace,
      };
    }

    const result = parseClaudeOutput(execution.stdout, request, { omitRawOutput: Boolean(mode) });
    return {
      result,
      trace,
      coverageEvidence: currentWorkerCoverageEvidence(request, result, workspace.rootPath),
    };
  }

  private async withSessionLock(request: DiagnosticRequest, options: DiagnosticWorkerOptions): Promise<ClaudeWorkerResponse> {
    const claudeSessionId = request.claudeSessionId;
    const previous = ClaudeCodeWorker.sessionQueues.get(claudeSessionId) ?? Promise.resolve();
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);
    ClaudeCodeWorker.sessionQueues.set(claudeSessionId, current);

    try {
      const ready = await waitForSession(previous, options.signal);
      if (!ready) return mockDiagnosticResponse(request, 'Worker cancelled', new Date().toISOString());
      return await this.diagnoseUnlocked(request, options);
    } finally {
      release!();
      void current.then(() => {
        if (ClaudeCodeWorker.sessionQueues.get(claudeSessionId) === current) {
          ClaudeCodeWorker.sessionQueues.delete(claudeSessionId);
        }
      });
    }
  }
}

function isMaxTurns(stdout: string): boolean {
  try { const value = JSON.parse(stdout); return value?.type === 'result' && value.subtype === 'error_max_turns'; }
  catch { return false; }
}

function waitForSession(previous: Promise<void>, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (ready: boolean) => { signal?.removeEventListener('abort', abort); resolve(ready); };
    const abort = () => finish(false);
    signal?.addEventListener('abort', abort, { once: true });
    void previous.then(() => finish(!signal?.aborted), () => finish(!signal?.aborted));
  });
}

function sessionArgs(request: DiagnosticRequest): string[] {
  return request.runId === 'run_01'
    ? ['--session-id', request.claudeSessionId]
    : ['--resume', request.claudeSessionId];
}
