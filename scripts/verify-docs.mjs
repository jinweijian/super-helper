import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const checks = [
  {
    file: 'AGENTS.md',
    terms: ['Coding Agent Rules', '仓库开发规范', '强制模块边界', 'src/agents/', 'src/gateway/', 'src/runtime/', 'DiagnosticRequest'],
  },
  {
    file: 'docs/development-standards.md',
    terms: ['Development Standards', 'Module Ownership Map', 'src/agents/', 'Experience Agent', 'Session Lifecycle Contract', 'Anti-Patterns'],
  },
  {
    file: 'src/agents/main.md',
    terms: ['super helper Main Agent', 'Preflight Gate', '不能乱猜', 'DiagnosticRequest', 'Claude Code is a tool', 'Prompt Regression Cases'],
  },
  {
    file: 'src/agents/input-review.md',
    terms: ['Input Review Agent', 'Preflight Gate', 'DiagnosticRequest'],
  },
  {
    file: 'src/agents/experience.md',
    terms: ['Experience Agent', 'history', 'Output Review Agent'],
  },
  {
    file: 'src/agents/output-review.md',
    terms: ['Output Review Agent', 'DiagnosticResult', 'unsupported'],
  },
  {
    file: 'src/agents/presentation.md',
    terms: ['Presentation Agent', 'persona', '不得新增'],
  },
  {
    file: 'src/agents/registry.json',
    terms: ['"stage": "experience"', '"configPath": "experience.md"', '"stage": "presentation"'],
  },
  {
    file: 'docs/product-requirements.md',
    terms: ['super helper', '极简对话页', '输入框吸底', '查看诊断日志', '用户质疑'],
  },
  {
    file: 'docs/product/README.md',
    terms: ['super helper PRD', 'AnswerGoal', 'Preflight Gate', 'RAG Answerability', 'Case Curator', '查看诊断日志', '验收标准'],
  },
  {
    file: 'docs/agent-design.md',
    terms: ['Preflight Gate', 'Experience Agent', '不能乱猜', '证据不足必须追问', 'DiagnosticRequest', 'Claude Code 不直接回复用户'],
  },
  {
    file: 'docs/technical-architecture.md',
    terms: ['caseId', 'runId', 'Worker Pool', 'workspace', 'MCP', '只读', 'agentActivity'],
  },
  {
    file: 'docs/agent-runtime/README.md',
    terms: ['Agent Runtime 技术总览', 'AnswerGoal', 'DiagnosticRequest', 'Preflight Gate', 'Experience Agent', 'Evidence Judge', 'primary_answer', 'Presentation'],
  },
  {
    file: 'docs/agent-runtime/contracts-and-data-flow.md',
    terms: ['ResolvedTurnContext', 'DiagnosticClaim', 'direct_answer', 'ValidatedDiagnosticResult', 'Presentation Output Contract'],
  },
  {
    file: 'docs/agent-runtime/knowledge-worker-review-flow.md',
    terms: ['Knowledge Router', 'RAG Answerability', 'Claude Code Worker', 'Deep Query Retry', 'Output Review'],
  },
  {
    file: 'docs/agent-runtime/observability-and-operations.md',
    terms: ['DiagnosticLogEvent', 'Agent Activity', 'WorkerTrace', 'Solved Case', '/api/logs'],
  },
  {
    file: 'docs/mvp-roadmap.md',
    terms: ['项目初始化', '极简对话 UI', 'mock Agent', '诊断日志抽屉', '多用户 run 队列'],
  },
];

let failed = false;

for (const check of checks) {
  const content = readFileSync(join(root, check.file), 'utf8');
  for (const term of check.terms) {
    if (!content.includes(term)) {
      console.error(`Missing required term "${term}" in ${check.file}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log('Docs lint passed: core product, agent, architecture, and roadmap terms are covered.');
