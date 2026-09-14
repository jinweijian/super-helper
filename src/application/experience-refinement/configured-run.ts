import { loadConfig, getModelProvider } from '../../config.js';
import { FileSecretsRepository, materializeConfigSecrets } from '../../onboarding/secrets.js';
import { createModelClient } from '../../providers/model/adapter.js';
import { sha256 } from '../../knowledge/experience/provenance.js';
import type { ExperienceImportOptions } from '../../knowledge/experience/csv/import-contracts.js';
import { refineExperienceBatch } from './refine-batch.js';

export async function runConfiguredRefinement(input: {
  configFile: string; root: string; scope: ExperienceImportOptions; jobId: string; maxCalls: number;
  enableModel: boolean; signal?: AbortSignal;
}) {
  if (!input.enableModel) throw new Error('EXPERIENCE_MODEL_OPT_IN_REQUIRED');
  let provider;
  try {
    const config = loadConfig(input.configFile);
    provider = getModelProvider(materializeConfigSecrets(config, new FileSecretsRepository(config.storage.rootDir)));
    if (!provider?.baseUrl || !provider.model) throw new Error();
  } catch { throw new Error('EXPERIENCE_MODEL_CONFIG_INVALID'); }
  const fingerprint = sha256(JSON.stringify({ baseUrl: provider.baseUrl, model: provider.model,
    temperature: provider.temperature ?? 0, maxTokens: provider.maxTokens ?? 1200, timeoutMs: provider.timeoutMs ?? 60000 }));
  return refineExperienceBatch({ root: input.root, scope: input.scope, jobId: input.jobId, maxCalls: input.maxCalls,
    modelFingerprint: fingerprint, model: createModelClient(provider), signal: input.signal });
}
