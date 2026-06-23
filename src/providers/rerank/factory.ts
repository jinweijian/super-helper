import { ProviderError } from '../errors.js';
import type { ProviderFactoryOptions } from '../http.js';
import type {
  RerankProvider,
  RerankProviderConfig,
} from './contract.js';
import { FakeRerankProvider } from './fake.js';
import { SiliconFlowRerankProvider } from './siliconflow/adapter.js';

export function createRerankProvider(
  config: RerankProviderConfig,
  options: ProviderFactoryOptions = {},
): RerankProvider {
  if (config.provider === 'siliconflow') {
    return new SiliconFlowRerankProvider(config, options.fetch ?? fetch);
  }
  if (config.provider === 'fake') {
    return new FakeRerankProvider(config);
  }
  throw new ProviderError({
    provider: config.provider,
    code: 'unsupported_provider',
    retryable: false,
    safeMessage: `Unsupported rerank provider: ${config.provider}`,
  });
}
