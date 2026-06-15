import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { SecretRef } from '../domain.js';
import type {
  OnboardingDraft,
  OnboardingValidationIssue,
  OnboardingValidationResult,
} from './types.js';

export function validateOnboardingDraft(
  draft: OnboardingDraft,
  dependencies: { resolveSecret(ref?: SecretRef): string | undefined },
): OnboardingValidationResult {
  const issues: OnboardingValidationIssue[] = [];
  const add = (field: string, code: string, message: string): void => {
    issues.push({ field, code, message });
  };

  if (!isExistingDirectory(draft.workspace.rootPath)) {
    add('workspace.rootPath', 'directory_not_found', 'Workspace root must be an existing directory.');
  }
  if (!isAbsolute(draft.knowledge.rootDir)) {
    add('knowledge.rootDir', 'path_not_absolute', 'Knowledge root must be an absolute path.');
  }
  if (draft.knowledge.sourceDir && !isExistingDirectory(draft.knowledge.sourceDir)) {
    add('knowledge.sourceDir', 'directory_not_found', 'Knowledge source directory must exist.');
  }
  if (!Number.isInteger(draft.server.port) || draft.server.port < 1 || draft.server.port > 65_535) {
    add('server.port', 'invalid_port', 'Server port must be an integer between 1 and 65535.');
  }
  if (draft.server.bindMode !== 'loopback' && draft.server.bindMode !== 'lan') {
    add('server.bindMode', 'invalid_bind_mode', 'Server bind mode must be loopback or lan.');
  }

  if (!draft.agent.providerId.trim()) {
    add('agent.providerId', 'required', 'Agent provider id is required.');
  }
  if (!draft.agent.provider.baseUrl.trim()) {
    add('agent.provider.baseUrl', 'required', 'Agent provider base URL is required.');
  }
  if (!draft.agent.provider.model.trim()) {
    add('agent.provider.model', 'required', 'Agent model is required.');
  }
  if (!hasProviderSecret(draft.agent.provider, dependencies.resolveSecret)) {
    add('agent.provider.apiKeyRef', 'missing_credentials', 'Agent provider credentials are required.');
  }

  if (draft.embedding.enabled) {
    if (!isPositiveInteger(draft.embedding.dimensions)) {
      add('embedding.dimensions', 'invalid_number', 'Embedding dimensions must be a positive integer.');
    }
    if (draft.embedding.batchSize !== undefined && !isPositiveInteger(draft.embedding.batchSize)) {
      add('embedding.batchSize', 'invalid_number', 'Embedding batch size must be a positive integer.');
    }
    if (draft.embedding.timeoutMs !== undefined && !isPositiveInteger(draft.embedding.timeoutMs)) {
      add('embedding.timeoutMs', 'invalid_number', 'Embedding timeout must be a positive integer.');
    }
    if (
      draft.embedding.provider !== 'fake'
      && !hasProviderSecret(draft.embedding, dependencies.resolveSecret)
    ) {
      add('embedding.apiKeyRef', 'missing_credentials', 'Embedding provider credentials are required.');
    }
  }

  if (draft.rerank.enabled) {
    if (draft.rerank.topN !== undefined && !isPositiveInteger(draft.rerank.topN)) {
      add('rerank.topN', 'invalid_number', 'Rerank topN must be a positive integer.');
    }
    if (draft.rerank.timeoutMs !== undefined && !isPositiveInteger(draft.rerank.timeoutMs)) {
      add('rerank.timeoutMs', 'invalid_number', 'Rerank timeout must be a positive integer.');
    }
    if (draft.rerank.provider !== 'fake' && !hasProviderSecret(draft.rerank, dependencies.resolveSecret)) {
      add('rerank.apiKeyRef', 'missing_credentials', 'Rerank provider credentials are required.');
    }
  }

  return { ok: issues.length === 0, issues };
}

function isExistingDirectory(path: string): boolean {
  if (!isAbsolute(path) || !existsSync(path)) {
    return false;
  }
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function hasProviderSecret(
  provider: { apiKey?: string; apiKeyEnv?: string; apiKeyRef?: SecretRef },
  resolveSecret: (ref?: SecretRef) => string | undefined,
): boolean {
  if (provider.apiKey) {
    return true;
  }
  const ref = provider.apiKeyRef
    ?? (provider.apiKeyEnv ? { source: 'env' as const, name: provider.apiKeyEnv } : undefined);
  return Boolean(resolveSecret(ref));
}
