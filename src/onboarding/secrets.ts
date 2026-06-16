import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SuperHelperConfig } from '../config.js';
import type { SecretRef } from '../domain.js';
import { writeJsonAtomic } from './atomic-json.js';

interface SecretFile {
  version: 1;
  values: Record<string, string>;
}

export class FileSecretsRepository {
  readonly path: string;

  constructor(rootDir: string) {
    this.path = join(rootDir, 'secrets.json');
  }

  set(key: string, value: string): SecretRef {
    const file = this.read();
    file.values[key] = value;
    writeJsonAtomic(this.path, file, 0o600);
    chmodSync(this.path, 0o600);
    return { source: 'file', key };
  }

  resolve(ref?: SecretRef): string | undefined {
    if (!ref) {
      return undefined;
    }
    if (ref.source === 'env') {
      return process.env[ref.name];
    }
    return this.read().values[ref.key];
  }

  has(ref?: SecretRef): boolean {
    return Boolean(this.resolve(ref));
  }

  private read(): SecretFile {
    if (!existsSync(this.path)) {
      return { version: 1, values: {} };
    }
    return JSON.parse(readFileSync(this.path, 'utf8')) as SecretFile;
  }
}

export function materializeConfigSecrets(
  config: SuperHelperConfig,
  secrets: FileSecretsRepository,
): SuperHelperConfig {
  const copy = structuredClone(config);
  for (const provider of Object.values(copy.models.providers)) {
    provider.apiKey = secrets.resolve(provider.apiKeyRef) ?? provider.apiKey;
  }
  if (copy.embedding) {
    copy.embedding.apiKey = secrets.resolve(copy.embedding.apiKeyRef) ?? copy.embedding.apiKey;
  }
  if (copy.rerank) {
    copy.rerank.apiKey = secrets.resolve(copy.rerank.apiKeyRef) ?? copy.rerank.apiKey;
  }
  return copy;
}

export function migrateLegacyConfigSecrets(
  config: SuperHelperConfig,
  secrets: FileSecretsRepository,
): SuperHelperConfig {
  const copy = structuredClone(config);
  for (const [providerId, provider] of Object.entries(copy.models.providers)) {
    if (provider.apiKey && !provider.apiKeyRef) {
      provider.apiKeyRef = secrets.set(`providers.agent.${providerId}`, provider.apiKey);
      delete provider.apiKey;
    } else if (provider.apiKeyEnv && !provider.apiKeyRef) {
      provider.apiKeyRef = { source: 'env', name: provider.apiKeyEnv };
    }
  }

  for (const [key, provider] of [
    ['embedding', copy.embedding],
    ['rerank', copy.rerank],
  ] as const) {
    if (provider.apiKey && !provider.apiKeyRef) {
      provider.apiKeyRef = secrets.set(`providers.${key}`, provider.apiKey);
      delete provider.apiKey;
    } else if (provider.apiKeyEnv && !provider.apiKeyRef) {
      provider.apiKeyRef = { source: 'env', name: provider.apiKeyEnv };
    }
  }
  return copy;
}
