import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultConfig, loadConfig, saveConfig } from '../dist/config.js';
import {
  FileSecretsRepository,
  materializeConfigSecrets,
  migrateLegacyConfigSecrets,
} from '../dist/onboarding/index.js';

test('secret repository stores file secrets outside config and materializes runtime config', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const secrets = new FileSecretsRepository(root);
    const ref = secrets.set('providers.agent.default', 'sk-agent-secret');
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKeyRef: ref,
    };
    config.agent.modelProvider = 'default';

    saveConfig(config, join(root, 'config.json'));
    const persisted = readFileSync(join(root, 'config.json'), 'utf8');
    assert.doesNotMatch(persisted, /sk-agent-secret/);
    assert.match(persisted, /providers\.agent\.default/);
    assert.equal(statSync(join(root, 'secrets.json')).mode & 0o777, 0o600);

    const runtime = materializeConfigSecrets(loadConfig(join(root, 'config.json')), secrets);
    assert.equal(runtime.models.providers.default.apiKey, 'sk-agent-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy inline keys migrate to file SecretRefs without leaking plaintext', () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-onboarding-'));
  try {
    const config = defaultConfig();
    config.storage.rootDir = root;
    config.models.providers.default = {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKey: 'legacy-secret',
    };
    config.agent.modelProvider = 'default';
    const secrets = new FileSecretsRepository(root);

    const migrated = migrateLegacyConfigSecrets(config, secrets);
    saveConfig(migrated, join(root, 'config.json'));

    assert.equal(migrated.models.providers.default.apiKey, undefined);
    assert.equal(migrated.models.providers.default.apiKeyRef.key, 'providers.agent.default');
    assert.doesNotMatch(readFileSync(join(root, 'config.json'), 'utf8'), /legacy-secret/);
    assert.equal(secrets.resolve(migrated.models.providers.default.apiKeyRef), 'legacy-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
