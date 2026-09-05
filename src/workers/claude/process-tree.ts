import { spawn, type ChildProcess } from 'node:child_process';

/** POSIX 子进程是本次专属会话首进程，负 PID 只能命中这一进程组。 */
export function signalProcessTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (!child.pid) return;
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, signal); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
    }
    return;
  }
  // Windows 无 POSIX 进程组信号；taskkill /T 以本次 PID 为树根，不使用 shell。
  const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], {
    stdio: 'ignore', windowsHide: true,
  });
  killer.on('error', () => child.kill(signal));
  killer.on('close', (code) => { if (code !== 0) child.kill(signal); });
}
