#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { CandidateGrantStore } from './candidate-grants.js';
import { parseRedmineMcpConfig } from './config.js';
import { REDMINE_PROJECT_IDENTIFIER } from './contracts.js';
import { createRedmineReadonlyClient } from './redmine-api/client.js';
import { createRedmineIssueSearch } from './redmine-api/search.js';
import { createRedmineMcpServer } from './server.js';
import { connectRedmineStdio } from './transports/stdio.js';

export async function runRedmineMcpMain(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = parseRedmineMcpConfig(env);
  const client = createRedmineReadonlyClient({ apiKey: config.apiKey });
  const project = await client.getProject();
  if (project.identifier !== REDMINE_PROJECT_IDENTIFIER) throw new Error('project_scope_mismatch');
  const search = createRedmineIssueSearch({
    client,
    backend: config.backend,
    projectId: project.id,
    maxPages: config.maxPages,
    pageSize: config.pageSize,
    updatedWithinDays: config.updatedWithinDays,
    cacheTtlMs: config.cacheTtlMs,
  });
  const server = createRedmineMcpServer({
    search,
    client,
    projectId: project.id,
    grants: new CandidateGrantStore({ ttlMs: config.grantTtlMs }),
  });
  await connectRedmineStdio(server);
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  runRedmineMcpMain().catch((error) => {
    const safeCode = error instanceof Error && /^[a-z_]+$/u.test(error.message)
      ? error.message
      : 'service_unavailable';
    process.stderr.write(`redmine mcp failed (${safeCode})\n`);
    process.exitCode = 1;
  });
}
