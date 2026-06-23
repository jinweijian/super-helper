import type { SuperHelperConfig } from '../config.js';
import { saveConfig } from '../config.js';
import type { ClaudeSettingsInput, SettingsSecretStore } from './contracts.js';
import { publicSettings } from './public-view.js';

export function updateClaudeSettings(input: {
  config: SuperHelperConfig;
  secrets: SettingsSecretStore;
  body: ClaudeSettingsInput;
}): unknown {
  if (input.body.timeoutMs !== undefined) {
    input.config.claude.timeoutMs = Math.max(0, Number(input.body.timeoutMs));
  }
  if ('maxBudgetUsd' in input.body) {
    const maxBudgetUsd = optionalPositiveNumber(input.body.maxBudgetUsd);
    if (maxBudgetUsd === undefined) {
      delete input.config.claude.maxBudgetUsd;
    } else {
      input.config.claude.maxBudgetUsd = Math.max(0.01, maxBudgetUsd);
    }
  }
  if (input.body.sessionBusyMaxRetries !== undefined) {
    input.config.claude.sessionBusyMaxRetries = Math.max(0, Number(input.body.sessionBusyMaxRetries));
  }
  if (input.body.sessionBusyRetryDelayMs !== undefined) {
    input.config.claude.sessionBusyRetryDelayMs = Math.max(0, Number(input.body.sessionBusyRetryDelayMs));
  }
  saveConfig(input.config);
  return publicSettings(input.config, input.secrets);
}

function optionalPositiveNumber(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}
