import type { SecretRef } from '../domain.js';
import type { PublicSettingsSecretReader, SettingsSecretStore } from './contracts.js';

export interface SecretBearingProvider {
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyRef?: SecretRef;
}

export function applySubmittedSecret(
  provider: SecretBearingProvider,
  input: { apiKey?: string; apiKeyEnv?: string },
  secrets: SettingsSecretStore,
  key: string,
): void {
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    provider.apiKeyRef = secrets.set(key, apiKey);
    provider.apiKey = apiKey;
    return;
  }

  const apiKeyEnv = input.apiKeyEnv?.trim();
  if (apiKeyEnv) {
    provider.apiKeyRef = { source: 'env', name: apiKeyEnv };
    delete provider.apiKey;
  }
}

export function hasConfiguredSecret(
  config: SecretBearingProvider,
  secrets?: PublicSettingsSecretReader,
): boolean {
  return Boolean(
    config.apiKey ||
      (config.apiKeyEnv && process.env[config.apiKeyEnv]) ||
      (config.apiKeyRef && secrets?.has(config.apiKeyRef)),
  );
}
