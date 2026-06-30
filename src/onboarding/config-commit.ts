import type { SuperHelperConfig } from '../config.js';
import { saveConfig } from '../config.js';
import type { OnboardingDraft } from './types.js';

export function commitOnboardingConfig(input: {
  draft: OnboardingDraft;
  currentConfig: SuperHelperConfig;
  runId: string;
  path?: string;
  now?: string;
}): SuperHelperConfig {
  const config = buildOnboardingConfig({
    draft: input.draft,
    currentConfig: input.currentConfig,
    runId: input.runId,
    completedAt: input.now,
  });
  saveConfig(config, input.path);
  return config;
}

export function buildOnboardingConfig(input: {
  draft: OnboardingDraft;
  currentConfig: SuperHelperConfig;
  runId: string;
  completedAt?: string;
}): SuperHelperConfig {
  const config: SuperHelperConfig = structuredClone(input.currentConfig);
  const host = input.draft.server.host ?? (input.draft.server.bindMode === 'lan' ? '0.0.0.0' : '127.0.0.1');

  config.server = {
    ...config.server,
    host,
    port: input.draft.server.port,
    bindMode: input.draft.server.bindMode,
  };
  config.knowledge = {
    ...config.knowledge,
    rootDir: input.draft.knowledge.rootDir,
    sourceDir: input.draft.knowledge.sourceDir,
    buildVectorIndex: input.draft.knowledge.buildVectorIndex,
  };
  config.workspaces = [{
    id: input.draft.workspace.id,
    name: input.draft.workspace.name,
    rootPath: input.draft.workspace.rootPath,
    mcpToolIds: config.workspaces.find((workspace) => workspace.id === input.draft.workspace.id)?.mcpToolIds ?? [],
  }];
  config.models.providers[input.draft.agent.providerId] = structuredClone(input.draft.agent.provider);
  config.agent = {
    ...config.agent,
    modelProvider: input.draft.agent.providerId,
    useModelForPreflight: true,
  };
  config.embedding = structuredClone(input.draft.embedding);
  config.rerank = structuredClone(input.draft.rerank);
  config.onboarding = {
    version: 1,
    completedAt: input.completedAt ?? new Date().toISOString(),
    lastRunId: input.runId,
  };

  return config;
}
