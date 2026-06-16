import { spawn } from 'node:child_process';
import { platform } from 'node:process';

export function openBrowser(url: string): void {
  const command = browserCommand(url);
  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function browserCommand(url: string): { command: string; args: string[] } {
  if (platform === 'darwin') {
    return { command: 'open', args: [url] };
  }
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] };
  }
  return { command: 'xdg-open', args: [url] };
}
