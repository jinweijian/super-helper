import {
  runEmbeddingSmokeTest,
  runRerankSmokeTest,
  type EmbeddingProviderHealthCheckResult,
  type RerankProviderHealthCheckResult,
} from '../embedding/index.js';
import { runModelSmokeTest, type ModelSmokeTestResult } from '../model-smoke-test.js';
import type { OnboardingDraft } from './types.js';

export interface SkippedProviderTestResult {
  ok: true;
  skipped: true;
  reason: 'disabled';
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
  const skipped = (): SkippedProviderTestResult => ({
    ok: true,
    skipped: true,
    reason: 'disabled',
  });

  const [agent, embedding, rerank] = await Promise.all([
    dependencies.testAgent(draft),
    draft.embedding.enabled ? dependencies.testEmbedding(draft) : Promise.resolve(skipped()),
    draft.rerank.enabled ? dependencies.testRerank(draft) : Promise.resolve(skipped()),
  ]);

  return {
    ok: agent.ok && embedding.ok && rerank.ok,
    agent,
    embedding,
    rerank,
  };
}
