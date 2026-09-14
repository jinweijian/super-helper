import { ProviderError } from '../errors.js';
import { CogneeExperienceIndexProvider } from './cognee/adapter.js';
import type {
  ExperienceIndexProvider,
  ExperienceIndexProviderConfig,
  ExperienceIndexProviderFactoryOptions,
} from './contract.js';

export function createExperienceIndexProvider(
  config: ExperienceIndexProviderConfig,
  options: ExperienceIndexProviderFactoryOptions = {},
): ExperienceIndexProvider {
  if (!config.enabled) {
    throw new ProviderError({ provider: config.provider, code: 'disabled', retryable: false, safeMessage: 'Experience index is disabled.' });
  }
  if (config.provider !== 'cognee') {
    throw new ProviderError({ provider: config.provider, code: 'unsupported_provider', retryable: false, safeMessage: 'Experience index provider is not supported.' });
  }
  return new CogneeExperienceIndexProvider(config, options.fetch ?? fetch);
}
