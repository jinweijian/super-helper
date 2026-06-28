import {
  runEmbeddingSmokeTest,
  type EmbeddingProviderHealthCheckResult,
} from '../providers/embedding/index.js';
import {
  runRerankSmokeTest,
  type RerankProviderHealthCheckResult,
} from '../providers/rerank/index.js';
import { runModelSmokeTest, type ModelSmokeTestResult } from '../providers/model/smoke-test.js';
import type { OnboardingDraft } from './types.js';
import { providerHasExecutionCredentials } from './provider-credentials.js';

export interface SkippedProviderTestResult {
  ok: true;
  skipped: true;
  reason: 'disabled' | 'missing_credentials';
}

export interface OnboardingProviderTestResult {
  ok: boolean;
  agent: ModelSmokeTestResult;
  embedding: EmbeddingProviderHealthCheckResult | SkippedProviderTestResult;
  rerank: RerankProviderHealthCheckResult | SkippedProviderTestResult;
}

interface ProviderTestDependencies {
  testAgent(draft: OnboardingDraft): Promise<ModelSmokeTestResult>;
  testEmbedding(draft: OnboardingDraft): Promise<EmbeddingProviderHealthCheckResult>;
  testRerank(draft: OnboardingDraft): Promise<RerankProviderHealthCheckResult>;
}

const DEFAULT_DEPENDENCIES: ProviderTestDependencies = {
  testAgent: (draft) => runModelSmokeTest(draft.agent.provider),
  testEmbedding: (draft) => runEmbeddingSmokeTest({ config: draft.embedding }),
  testRerank: (draft) => runRerankSmokeTest({ config: draft.rerank }),
};

export async function testOnboardingProviders(
  draft: OnboardingDraft,
  dependencies: ProviderTestDependencies = DEFAULT_DEPENDENCIES,
): Promise<OnboardingProviderTestResult> {
  const skipped = (reason: SkippedProviderTestResult['reason']): SkippedProviderTestResult => ({
    ok: true,
    skipped: true,
    reason,
  });
  const embeddingReady = draft.embedding.enabled && providerHasExecutionCredentials(draft.embedding);
  const rerankReady = draft.rerank.enabled && providerHasExecutionCredentials(draft.rerank);

  const [agent, embedding, rerank] = await Promise.all([
    dependencies.testAgent(draft),
    embeddingReady
      ? dependencies.testEmbedding(draft)
      : Promise.resolve(skipped(draft.embedding.enabled ? 'missing_credentials' : 'disabled')),
    rerankReady
      ? dependencies.testRerank(draft)
      : Promise.resolve(skipped(draft.rerank.enabled ? 'missing_credentials' : 'disabled')),
  ]);

  return {
    ok: agent.ok && embedding.ok && rerank.ok,
    agent,
    embedding,
    rerank,
  };
}
