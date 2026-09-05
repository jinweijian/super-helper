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
    const mode = profiles?.enabled ? request.investigation?.resolvedProfile : undefined;
    const profile = mode ? profiles?.[mode] : undefined;
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
      ...(profile ? ['--model', profile.model, '--effort', profile.effort, '--prompt-suggestions', 'false'] : []),
      ...(mode === 'fast' ? ['--max-turns', String(profiles!.fast.maxTurns)] : []),
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

    const execution = await runCommandWithSessionBusyRetry(
      this.config.claude.command,
      args,
      workspace.rootPath,
      mode === 'deep' ? profiles!.deep.timeoutMs : this.config.claude.timeoutMs,
      this.config.claude.sessionBusyMaxRetries ?? 3,
      this.config.claude.sessionBusyRetryDelayMs ?? 3_000,
      { ...options, streamJson: mode === 'deep' },
    );
    const trace: WorkerTrace = {
      command: profile ? shellCommand('claude', args.slice(0, args.indexOf('--system-prompt'))) : command,
      cwd: profile ? '' : workspace.rootPath,
      stdout: profile ? '' : execution.stdout,
      stderr: profile ? '' : execution.stderr,
      exitCode: execution.exitCode,
      signal: execution.signal,
      error: profile && execution.error ? (options.signal?.aborted ? 'Worker cancelled' : 'Claude Code execution failed') : execution.error,
      startedAt,
      finishedAt: new Date().toISOString(),
    };

    if (mode === 'fast' && !execution.signal && !options.signal?.aborted && isMaxTurns(execution.stdout)) {
      return { result: parseClaudeOutput('{"type":"result","subtype":"error_max_turns"}', request, { omitRawOutput: true }),
        trace: { ...trace, error: undefined, exitCode: 0 } };
    }
    if (execution.exitCode !== 0 || execution.signal || execution.error) {
      return {
        result: failedExecutionDiagnosticResult(request, profile ? {
          ...execution, stdout: '', stderr: '',
          error: options.signal?.aborted ? 'Worker cancelled' : 'Claude Code execution failed',
        } : execution),
        trace,
      };
    }

    const result = parseClaudeOutput(execution.stdout, request, { omitRawOutput: Boolean(profile) });
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
