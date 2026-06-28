import type { SecretRef } from '../domain.js';

export interface ProviderCredentialConfig {
  provider?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyRef?: SecretRef;
}

export function providerNeedsCredentials(provider: ProviderCredentialConfig): boolean {
  return provider.provider !== 'fake';
}

export function providerHasExecutionCredentials(provider: ProviderCredentialConfig): boolean {
  if (!providerNeedsCredentials(provider)) {
    return true;
  }
  if (provider.apiKey?.trim()) {
    return true;
  }
  if (provider.apiKeyEnv?.trim() && process.env[provider.apiKeyEnv]) {
    return true;
  }
  if (provider.apiKeyRef?.source === 'env') {
    return Boolean(process.env[provider.apiKeyRef.name]);
  }
  return provider.apiKeyRef?.source === 'file';
}
