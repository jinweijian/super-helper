import type { SecretRef } from '../../domain.js';
import type { ExperienceGraphProvider } from '../../contracts/experience-index.js';
import type { ProviderFactoryOptions } from '../http.js';

export interface ExperienceIndexProviderConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  token?: string;
  tokenRef?: SecretRef;
  timeoutMs?: number;
}

export type ExperienceIndexProvider = ExperienceGraphProvider;
export type ExperienceIndexProviderFactoryOptions = ProviderFactoryOptions;
