import { networkInterfaces } from 'node:os';

export type ServerBindMode = 'loopback' | 'lan';

export interface ResolveServerBindingInput {
  bind?: ServerBindMode;
  host?: string;
  port?: number;
}

export interface ResolvedServerBinding {
  bindMode: ServerBindMode;
  listenHost: string;
  port: number;
  localUrl: string;
  lanUrls: string[];
  warning?: string;
}

export function resolveServerBinding(input: ResolveServerBindingInput): ResolvedServerBinding {
  const bindMode = input.bind ?? (input.host === '0.0.0.0' ? 'lan' : 'loopback');
  const listenHost = input.host?.trim() || (bindMode === 'lan' ? '0.0.0.0' : '127.0.0.1');
  const port = input.port ?? 4317;
  const urlHost = listenHost === '0.0.0.0' ? '127.0.0.1' : listenHost;
  const lanUrls = bindMode === 'lan' ? listPrivateIpv4Addresses().map((host) => `http://${host}:${port}`) : [];

  return {
    bindMode,
    listenHost,
    port,
    localUrl: `http://${urlHost}:${port}`,
    lanUrls,
    warning: bindMode === 'lan'
      ? 'MVP 模式会暴露在可信内网，当前暂未启用访问令牌，请只在受信任网络中使用。'
      : undefined,
  };
}

function listPrivateIpv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === 'IPv4' && !item.internal)
    .map((item) => item.address)
    .filter(isPrivateIpv4);
}

function isPrivateIpv4(address: string): boolean {
  return /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
}
