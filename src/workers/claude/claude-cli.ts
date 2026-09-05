import { spawn } from 'node:child_process';
import type { DiagnosticWorkerOptions } from '../diagnostic-worker.js';
import { ClaudeStream } from './claude-stream.js';
import { signalProcessTree } from './process-tree.js';

const MAX_OUTPUT_BUFFER = 1024 * 1024 * 5;

export interface CommandExecution {
  stdout: string;
  stderr: string;
  exitCode?: number;
  signal?: string;
  error?: string;
}

export interface CommandOptions extends DiagnosticWorkerOptions { streamJson?: boolean; terminationGraceMs?: number }

export function runCommand(command: string, args: string[], cwd: string, timeoutMs: number, options: CommandOptions = {}): Promise<CommandExecution> {
  if (options.signal?.aborted) return Promise.resolve({ stdout: '', stderr: '', error: 'Worker cancelled', signal: 'SIGTERM' });
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stream = options.streamJson ? new ClaudeStream(cwd, options.onProgress) : undefined;
    const terminate = () => {
      signalProcessTree(child, 'SIGTERM');
      killTimer ??= setTimeout(() => signalProcessTree(child, 'SIGKILL'), options.terminationGraceMs ?? 1000);
    };
    const abort = () => { cancelled = true; terminate(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          terminate();
        }, timeoutMs)
      : undefined;

    child.stdout.on('data', (chunk) => {
      if (stream) stream.push(String(chunk));
      else stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ stdout, stderr, error: error.message });
    });
    child.on('close', (code, signal) => {
      if (cancelled || timedOut) signalProcessTree(child, 'SIGKILL');
      options.signal?.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
      stream?.finish();
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        stdout: stream ? stream.result : stdout,
        stderr,
        exitCode: code ?? undefined,
        signal: signal ?? (timedOut ? 'SIGTERM' : undefined),
        error: cancelled ? 'Worker cancelled' : timedOut ? `Command timed out after ${timeoutMs}ms` : code && code !== 0 ? `Command exited with code ${code}` : undefined,
      });
    });
  });
}

export async function runCommandWithSessionBusyRetry(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  maxRetries: number,
  retryDelayMs: number,
  options: CommandOptions = {},
): Promise<CommandExecution> {
  const attempts: CommandExecution[] = [];
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const execution = await runCommand(command, args, cwd, timeoutMs, options);
    attempts.push(execution);
    if (options.signal?.aborted || !isSessionBusy(execution) || attempt >= maxRetries) {
      return mergeAttempts(attempts);
    }
    await sleep(retryDelayMs, options.signal);
  }

  return mergeAttempts(attempts);
}

export function shellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellEscape).join(' ');
}

function isSessionBusy(execution: CommandExecution): boolean {
  return Boolean(
    execution.exitCode !== 0 &&
      /Session ID .+ is already in use/i.test(`${execution.stderr}\n${execution.stdout}\n${execution.error ?? ''}`),
  );
}

function mergeAttempts(attempts: CommandExecution[]): CommandExecution {
  const last = attempts.at(-1) ?? { stdout: '', stderr: '' };
  if (attempts.length <= 1) {
    return last;
  }

  return {
    ...last,
    stdout: last.stdout,
    stderr: attempts.map((attempt, index) => `[attempt ${index + 1}]\n${attempt.stderr}`.trim()).join('\n'),
  };
}

function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, Math.max(0, delayMs));
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function appendBounded(existing: string, chunk: unknown): string {
  const next = existing + String(chunk);
  return next.length > MAX_OUTPUT_BUFFER ? next.slice(next.length - MAX_OUTPUT_BUFFER) : next;
}

function shellEscape(value: string): string {
  if (/^[a-zA-Z0-9_./:=,@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}
