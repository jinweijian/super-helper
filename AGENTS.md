# supper helper Coding Agent Rules

**与用户交互的语言与文档全部要用中文交互**

**用途：这是仓库开发规范。**

后续 Codex、AI coding agent、人工开发者在修改本仓库代码时，走这个文件。

不要把本文件和产品 Agent 配置混用：

- `AGENTS.md` 约束“怎么开发这个项目”。
- `src/agents/` 约束“supper helper 产品里的主 Agent 与子 Agent 应该怎么表现”。

请用中文与用户沟通。

本仓库不是随意 vibe coding 的项目。后续任何 AI coding、人工开发、重构、修复都必须遵守本文件和 `docs/development-standards.md` 的模块边界。

## 必读顺序

在修改代码前，先阅读：

1. `docs/development-standards.md`
2. `docs/technical-architecture.md`
3. `docs/agent-design.md`
4. `src/agents/README.md`
5. `src/agents/main.md`

如果改动涉及 OpenSpec change，还必须先阅读对应 change 的 proposal/design/spec/tasks。

## 强制模块边界

- `src/gateway/` 只负责 HTTP、路由、DTO、请求响应序列化。不得写 Preflight、worker、review、presentation 业务决策。
- `src/runtime/` 只负责 Agent runtime 编排和运行时决策。不得直接写 HTTP 响应，不得解析 URL 或拼接 API DTO。
- `src/agents/` 只负责产品 Agent 配置和 `registry.json` 配对规则。不得写 runtime 编排、HTTP、worker 或持久化逻辑。
- `src/sessions/` 只负责 case repository port、case context、会话上下文构建。不得调用 Claude Code 或模型。
- `src/workers/` 只负责 worker port 和具体 worker adapter。不得直接回复用户，不得改写 case 会话主状态。
- `src/observability/` 只负责日志展示结构和可观测性转换。不得决定诊断流程。
- `src/agent.ts`、`src/server.ts`、`src/claude-worker.ts` 必须保持薄兼容入口，不得重新堆业务逻辑。

## 开发硬规则

- 新功能必须先确定所属模块；无法归属时先更新设计文档，不要直接写代码。
- 不允许把一个完整流程从入口文件一路写到底。
- 不允许在 route 里调用 Claude worker 或模型。
- 不允许让 Claude Code 或 MCP 工具直接生成用户最终回复。
- 不允许把产品 Agent prompt/config 写到根目录、runtime helper、worker adapter 或普通 docs 中；必须放在 `src/agents/` 并登记到 `registry.json`。
- 不允许绕过 `DiagnosticRequest` / `DiagnosticResult` / Evidence Review contract。
- 不允许无证据输出最终结论；事实、推断、假设、未知必须区分。
- 不允许破坏现有 API response shape，除非 OpenSpec 明确变更并更新兼容测试。
- 不允许修改持久化 case JSON shape，除非有迁移策略和测试。

## 每次改动最低验证

- 文档或结构改动：运行 `pnpm lint`。
- TypeScript 改动：运行 `pnpm typecheck`。
- 构建相关改动：运行 `pnpm build`。
- 运行时、gateway、worker、session、agent 行为改动：运行 `pnpm test`。

无法运行验证时，必须在最终回复中说明原因和风险。
