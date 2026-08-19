import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import test from 'node:test';
import { createSdkMcpClient } from '../dist/mcp/sdk-client.js';

const fixture = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'redmine-mcp-stdio.mjs');

test('production MCP SDK stdio transport lists only two tools and preserves a search grant', async () => {
  const server = {
    id: 'fixture-redmine',
    name: 'Fixture Redmine',
    protocol: 'stdio',
    permission: 'read_only',
    enabled: true,
    allowedToolNames: ['redmine_search_issues', 'redmine_get_issue_case_details'],
    timeoutMs: 15_000,
  };
  const client = await createSdkMcpClient({
    server,
    transport: {
      protocol: 'stdio',
      command: process.execPath,
      args: [fixture],
      env: {},
    },
  });
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'redmine_get_issue_case_details',
      'redmine_search_issues',
    ]);

    const search = await client.callTool('redmine_search_issues', { query: '视频加载', signals: [] });
    assert.equal(search.structuredContent.status, 'completed');
    assert.equal(search.structuredContent.candidates.length, 1);

    const details = await client.callTool('redmine_get_issue_case_details', {
      searchId: search.structuredContent.searchId,
      issueIds: [118740],
    });
    assert.equal(details.structuredContent.status, 'completed');
    assert.equal(details.structuredContent.details[0].issueId, 118740);
  } finally {
    await client.close();
  }
});
