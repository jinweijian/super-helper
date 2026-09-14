import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('authority adapter contract is exported independently of the CC implementation', async () => {
  const domain = await import('../dist/domain.js');
  assert.equal(typeof domain, 'object');
  const worker = await import('../dist/workers/authority/fake-authority-adapter.js');
  assert.equal(typeof worker.FakeAuthorityDiagnosticAdapter, 'function');
});

test('online diagnosis disables the legacy knowledge branch explicitly', async () => {
  const source = await readFile(new URL('../src/runtime/runtime-composition.ts', import.meta.url), 'utf8');
  assert.match(source, /onlineDiagnosisEnabled === false \? undefined : knowledgeTurn/);
  assert.doesNotMatch(source, /knowledgeTurn\.answer/);
});
