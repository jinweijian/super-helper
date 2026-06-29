import type { ModelProviderConfig, SuperHelperConfig } from '../config.js';
import type { SecretRef } from '../domain.js';
import { checkKnowledgeVectorCompatibility, discoverSourceFiles, resolveKnowledgeWorkspaceRoot } from '../knowledge/index.js';
import { createEmbeddingProvider } from '../providers/embedding/factory.js';
import { providerHasExecutionCredentials } from './provider-credentials.js';
import { FileSecretsRepository } from './secrets.js';
import type { OnboardingDraft, OnboardingDraftInput } from './types.js';

export function knowledgeWorkspaceRootForDraft(draft: OnboardingDraft, currentConfig: SuperHelperConfig): string {
  const config = structuredClone(currentConfig);
  config.knowledge = {
    ...config.knowledge,
    rootDir: draft.knowledge.rootDir,
  };
  config.workspaces = [{
    id: draft.workspace.id,
    name: draft.workspace.name,
    rootPath: draft.workspace.rootPath,
    mcpToolIds: config.workspaces.find((workspace) => workspace.id === draft.workspace.id)?.mcpToolIds ?? [],
  }];
  return resolveKnowledgeWorkspaceRoot(config, draft.workspace.id);
}

export function materializeDraftSecrets(draft: OnboardingDraft, secrets: FileSecretsRepository): OnboardingDraft {
  const copy = structuredClone(draft);
  copy.agent.provider.apiKey = secrets.resolve(copy.agent.provider.apiKeyRef) ?? copy.agent.provider.apiKey;
  copy.embedding.apiKey = secrets.resolve(copy.embedding.apiKeyRef) ?? copy.embedding.apiKey;
  copy.rerank.apiKey = secrets.resolve(copy.rerank.apiKeyRef) ?? copy.rerank.apiKey;
  return copy;
}

export function rejectUnsafeDraftInput(input: OnboardingDraftInput): void {
  const provider = input.draft.agent.provider as Record<string, unknown>;
  const embedding = input.draft.embedding as Record<string, unknown>;
  const rerank = input.draft.rerank as Record<string, unknown>;
  if (provider.apiKey || provider.apiKeyEnv || embedding.apiKey || embedding.apiKeyEnv || rerank.apiKey || rerank.apiKeyEnv) {
    throw new Error('Onboarding draft input cannot include plaintext secrets or apiKeyEnv; use secrets or env apiKeyRef.');
  }
  for (const [field, ref] of [
    ['agent.provider.apiKeyRef', input.draft.agent.provider.apiKeyRef],
    ['embedding.apiKeyRef', input.draft.embedding.apiKeyRef],
    ['rerank.apiKeyRef', input.draft.rerank.apiKeyRef],
  ] as const) {
    if (ref && ref.source !== 'env') {
      throw new Error(`${field} must be an env SecretRef in public input.`);
    }
  }
}

export function sanitizeDraft(draft: OnboardingDraft, secrets: FileSecretsRepository): Record<string, unknown> {
  return {
    version: draft.version,
    revision: draft.revision,
    workspace: draft.workspace,
    knowledge: draft.knowledge,
    server: draft.server,
    agent: {
      providerId: draft.agent.providerId,
      provider: sanitizeProvider(draft.agent.provider, secrets),
    },
    embedding: sanitizeProvider(draft.embedding, secrets),
    rerank: sanitizeProvider(draft.rerank, secrets),
    updatedAt: draft.updatedAt,
  };
}

export function draftFromConfig(config: SuperHelperConfig): OnboardingDraft {
  const workspace = config.workspaces[0] ?? {
    id: 'current',
    name: 'Current Project',
    rootPath: process.cwd(),
    mcpToolIds: [],
  };
  const providerId = activeModelProviderId(config);
  return {
    version: 1,
    revision: 0,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
    },
    knowledge: {
      rootDir: config.knowledge.rootDir,
      sourceDir: config.knowledge.sourceDir,
      buildVectorIndex: config.knowledge.buildVectorIndex,
      chunking: config.knowledge.chunking,
    },
    server: {
      bindMode: config.server.bindMode,
      host: config.server.host,
      port: config.server.port,
    },
    agent: {
      providerId,
      provider: providerForDraft(config.models.providers[providerId] ?? defaultOnboardingAgentProvider()),
    },
    embedding: providerForDraft(config.embedding),
    rerank: providerForDraft(config.rerank),
    updatedAt: config.onboarding.completedAt ?? new Date(0).toISOString(),
  };
}

export function preserveExistingSecretRefs(
  draft: OnboardingDraft,
  previous: OnboardingDraft | undefined,
  secrets: OnboardingDraftInput['secrets'] | undefined,
): void {
  if (
    !secrets?.agentApiKey
    && !draft.agent.provider.apiKeyRef
    && previous?.agent.providerId === draft.agent.providerId
    && previous.agent.provider.apiKeyRef
  ) {
    draft.agent.provider.apiKeyRef = previous.agent.provider.apiKeyRef;
  }
  preserveProviderSecretRef(draft.embedding, previous?.embedding, Boolean(secrets?.embeddingApiKey));
  preserveProviderSecretRef(draft.rerank, previous?.rerank, Boolean(secrets?.rerankApiKey));
}

export function sourceChangesForDraft(draft: OnboardingDraft): { added: string[]; changed: string[]; unchanged: string[] } {
  if (!draft.knowledge.sourceDir) {
    return { added: [], changed: [], unchanged: [] };
  }
  return { added: discoverSourceFiles(draft.knowledge.sourceDir), changed: [], unchanged: [] };
}

export function vectorCompatibilityForDraft(draft: OnboardingDraft): 'compatible' | 'missing-index' | 'rebuild-required' {
  if (
    !draft.knowledge.buildVectorIndex
    || !draft.embedding.enabled
    || !providerHasExecutionCredentials(draft.embedding)
  ) {
    return 'compatible';
  }
  try {
    createEmbeddingProvider(draft.embedding);
    return checkKnowledgeVectorCompatibility({
      workspaceRoot: draft.knowledge.rootDir,
      embeddingConfig: draft.embedding,
    }).status;
  } catch {
    return 'rebuild-required';
  }
}

function sanitizeProvider<T extends { apiKeyRef?: OnboardingDraft['agent']['provider']['apiKeyRef'] }>(
  provider: T,
  secrets: FileSecretsRepository,
): Omit<T, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> & { apiKeyRef?: Record<string, string>; hasApiKey: boolean } {
  const { apiKey: _apiKey, apiKeyEnv: _apiKeyEnv, apiKeyRef, ...rest } = provider as T & {
    apiKey?: string;
    apiKeyEnv?: string;
  };
  return {
    ...rest,
    apiKeyRef: apiKeyRef ? sanitizeSecretRef(apiKeyRef) : undefined,
    hasApiKey: secrets.has(apiKeyRef),
  };
}

function sanitizeSecretRef(ref: NonNullable<OnboardingDraft['agent']['provider']['apiKeyRef']>): Record<string, string> {
  return ref.source === 'env'
    ? { source: 'env', name: ref.name }
    : { source: 'file' };
}

function activeModelProviderId(config: SuperHelperConfig): string {
  if (config.agent.modelProvider && config.models.providers[config.agent.modelProvider]) {
    return config.agent.modelProvider;
  }
  return Object.keys(config.models.providers)[0] ?? 'default';
}

function defaultOnboardingAgentProvider(): ModelProviderConfig {
  return {
    type: 'openai-compatible',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: '',
  };
}

function providerForDraft<T extends { apiKey?: string; apiKeyEnv?: string; apiKeyRef?: SecretRef }>(provider: T): T {
  const copy = structuredClone(provider);
  if (!copy.apiKeyRef && copy.apiKeyEnv) {
    copy.apiKeyRef = { source: 'env', name: copy.apiKeyEnv };
  }
  delete copy.apiKey;
  delete copy.apiKeyEnv;
  return copy;
}

function preserveProviderSecretRef<T extends { provider: string; apiKeyRef?: SecretRef }>(
  provider: T,
  previous: T | undefined,
  hasNewSecret: boolean,
): void {
  if (hasNewSecret || provider.apiKeyRef || !previous?.apiKeyRef) {
    return;
  }
  if (provider.provider !== previous.provider) {
    return;
  }
  provider.apiKeyRef = previous.apiKeyRef;
}
