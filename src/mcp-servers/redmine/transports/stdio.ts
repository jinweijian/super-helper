import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function connectRedmineStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
