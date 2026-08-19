import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  REDMINE_API_KEY_SECRET,
  runRedmineCommand,
} from '../dist/cli/command-redmine.js';

test('redmine secret set stores a confirmed hidden value without printing it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-secret-'));
  const writes = [];
  const answers = ['redmine-fixture-secret', 'redmine-fixture-secret'];
  try {
    const ok = await runRedmineCommand({
      argv: ['secret', 'set'],
      rootDir: root,
      readSecret: async () => answers.shift() ?? '',
      write: (line) => writes.push(line),
    });

    const stored = readFileSync(join(root, 'secrets.json'), 'utf8');
    assert.equal(ok, true);
    assert.match(stored, new RegExp(REDMINE_API_KEY_SECRET.replaceAll('.', '\\.')));
    assert.match(stored, /redmine-fixture-secret/);
    assert.equal(statSync(join(root, 'secrets.json')).mode & 0o777, 0o600);
    assert.equal(writes.join('\n').includes('redmine-fixture-secret'), false);
    assert.deepEqual(writes, ['redmine secret: configured']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('redmine secret set rejects empty or mismatched confirmation without writing a secret', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-secret-'));
  try {
    const emptyLines = [];
    assert.equal(await runRedmineCommand({
      argv: ['secret', 'set'],
      rootDir: root,
      readSecret: async () => '',
      write: (line) => emptyLines.push(line),
    }), false);
    assert.deepEqual(emptyLines, ['redmine secret: failed (empty_secret)']);
    assert.equal(existsSync(join(root, 'secrets.json')), false);

    const answers = ['first-secret', 'second-secret'];
    const mismatchLines = [];
    assert.equal(await runRedmineCommand({
      argv: ['secret', 'set'],
      rootDir: root,
      readSecret: async () => answers.shift() ?? '',
      write: (line) => mismatchLines.push(line),
    }), false);
    assert.deepEqual(mismatchLines, ['redmine secret: failed (confirmation_mismatch)']);
    assert.equal(existsSync(join(root, 'secrets.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
