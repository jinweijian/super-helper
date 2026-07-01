import { spawn } from 'node:child_process';

const MAX_OUTPUT_BUFFER = 1024 * 1024 * 5;

export interface CommandExecution {
  stdout: string;
  stderr: string;
  exitCode?: number;
  signal?: string;
  error?: string;
}

export function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandExecution> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs)
      : undefined;

    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on('error', (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ stdout, stderr, error: error.message });
    });
    child.on('close', (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        stdout,
        stderr,
        exitCode: code ?? undefined,
        signal: signal ?? (timedOut ? 'SIGTERM' : undefined),
        error: timedOut ? `Command timed out after ${timeoutMs}ms` : code && code !== 0 ? `Command exited with code ${code}` : undefined,
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
): Promise<CommandExecution> {
  const attempts: CommandExecution[] = [];
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const execution = await runCommand(command, args, cwd, timeoutMs);
    attempts.push(execution);
    if (!isSessionBusy(execution) || attempt >= maxRetries) {
      return mergeAttempts(attempts);
    }
    await sleep(retryDelayMs);
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

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));
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
