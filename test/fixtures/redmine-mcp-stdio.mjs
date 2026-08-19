import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRedmineMcpServer } from '../../dist/mcp-servers/redmine/server.js';

const rawIssue = {
  id: 118740,
  project: { id: 77, name: 'Support' },
  tracker: { id: 1, name: '工单' },
  status: { id: 1, name: '新建' },
  priority: { id: 2, name: '普通' },
  subject: '视频加载失败',
  description: '检查转码队列',
  created_on: '2026-08-18T00:00:00Z',
  updated_on: '2026-08-19T00:00:00Z',
  custom_fields: [],
  journals: [],
  relations: [],
  attachments: [],
  watchers: [],
};

let activeIssue = rawIssue;

const server = createRedmineMcpServer({
  search: {
    backend: 'issues_scan',
    async search(input) {
      if (input.query === 'NOHIT') return [];
      activeIssue = input.query === 'DIRECTION'
        ? { ...rawIssue, description: 'direction-marker：可检查转码链路，但历史记录没有当前环境结论' }
        : { ...rawIssue, description: 'resolved-marker：历史记录确认转码队列配置异常' };
      return [activeIssue];
    },
  },
  client: {
    async getRawIssue(issueId) {
      if (issueId !== activeIssue.id) throw new Error('unexpected fixture issue');
      return activeIssue;
    },
  },
  projectId: 77,
  createServer: (info) => new McpServer(info),
});

await server.connect(new StdioServerTransport());
