import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { boundCaseDetails } from '../dist/mcp-servers/redmine/redmine-api/bounding.js';
import {
  normalizeIssueCandidate,
  normalizeIssueDetails,
} from '../dist/mcp-servers/redmine/redmine-api/normalizer.js';
import { IssueResponseSchema } from '../dist/mcp-servers/redmine/redmine-api/protocol.js';

const fixture = JSON.parse(readFileSync(
  join(process.cwd(), 'test', 'fixtures', 'redmine', 'issue-sensitive.json'),
  'utf8',
));

const FORBIDDEN = [
  '张三',
  '李四',
  '王五',
  'jwj',
  'lisi',
  'zhangsan@example.test',
  '10.24.3.9',
  '13800138000',
  '13900139000',
  '用户ID:638',
  'top-secret-token',
  'session-secret',
  '客户名单-secret.pdf',
  '/attachments/download/',
  'file-secret',
  '包含客户正文',
  '客户联系人',
  '私密备注',
];

test('normalizer permanently removes private notes, identities, attachment locators, and unknown fields', () => {
  const parsed = IssueResponseSchema.parse(fixture).issue;
  const candidate = normalizeIssueCandidate(parsed);
  const details = normalizeIssueDetails(parsed);
  const serialized = JSON.stringify({ candidate, details });

  assert.equal(candidate.issueId, 118740);
  assert.equal(candidate.sourceLocator, 'redmine:issue:118740');
  assert.equal(details.issueId, 118740);
  assert.equal(details.evidenceBlocks.some((block) => block.kind === 'journal'), true);
  assert.equal(details.evidenceBlocks.some((block) => block.kind === 'status_change'), true);
  assert.deepEqual(
    details.evidenceBlocks.find((block) => block.kind === 'attachment_metadata')?.metadata,
    { count: 1, items: [{ mimeType: 'application/pdf', size: 2048 }] },
  );
  assert.equal(details.evidenceBlocks.some(
    (block) => block.kind === 'custom_field' && block.label === '环境',
  ), true);
  assert.equal(details.evidenceBlocks.some(
    (block) => block.kind === 'custom_field' && block.label === '客户联系人',
  ), false);
  for (const forbidden of FORBIDDEN) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(serialized.includes('includePrivateNotes'), false);
});

test('bounding removes complete low-priority blocks and returns valid metadata', () => {
  const parsed = IssueResponseSchema.parse(fixture).issue;
  const base = normalizeIssueDetails(parsed);
  const details = [0, 1, 2].map((index) => ({
    ...structuredClone(base),
    issueId: base.issueId + index,
    sourceLocator: `redmine:issue:${base.issueId + index}`,
    evidenceBlocks: base.evidenceBlocks.map((block) => ({
      ...block,
      id: `${block.id}:${index}`,
      text: block.text ? `${block.text} ${'检查项'.repeat(200)}` : block.text,
    })),
  }));
  const originalBlockIds = new Set(details.flatMap((detail) => detail.evidenceBlocks.map((block) => block.id)));

  const bounded = boundCaseDetails(details, 4_500);
  const serialized = JSON.stringify(bounded);

  assert.equal(bounded.truncated, true);
  assert.ok(bounded.omittedBlocks > 0);
  assert.ok(bounded.outputCharacters <= 4_500);
  assert.equal(bounded.originalCharacters > bounded.outputCharacters, true);
  for (const detail of bounded.details) {
    for (const block of detail.evidenceBlocks) assert.equal(originalBlockIds.has(block.id), true);
  }
  assert.doesNotThrow(() => JSON.parse(serialized));
  for (const forbidden of FORBIDDEN) assert.equal(serialized.includes(forbidden), false, forbidden);
});
