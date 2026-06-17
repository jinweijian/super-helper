# super helper

`super helper` 是一个以聊天为入口的本地诊断助手。它围绕任意项目工作区、可配置 MCP 工具和企业知识库，帮助用户整理问题、检索证据、调用只读诊断工具，并输出经过证据审核的结论。

产品里刻意拆开了两类职责：

- `super helper Agent` 负责与用户对话、判断信息是否足够、必要时追问、审核证据、解释结论。
- Claude Code 是被 Agent 调用的诊断工具。在当前最小可用版里，Claude Code 不直接面向用户回复。

## 快速开始

在仓库根目录执行：

```bash
pnpm install
pnpm onboard
```

如果你用 npm：

```bash
npm install
npm run onDashboard
```

`pnpm onboard` 和 `npm run onDashboard` 都会构建项目并启动 Setup Dashboard。打开页面后，一次完成：

- 项目工作区配置
- 知识库根目录与原始知识文件目录配置
- Agent 模型配置
- Embedding 模型配置
- Rerank 模型配置
- 知识库导入、提取、标准化、切片、审计、发布、索引和健康检查

如果需要发布到可信内网：

```bash
pnpm onboard -- --bind lan
npm run onDashboard -- --bind lan
```

LAN 模式会绑定 `0.0.0.0`，方便同一内网访问。当前 MVP 暂未实现访问令牌，请只在可信内网使用。

日常启动已经完成配置的项目：

```bash
pnpm dashboard
npm run dashboard
```

查看本地状态和诊断本地配置：

```bash
pnpm status
pnpm doctor
npm run status
npm run doctor
```

## 本地落盘位置

默认配置文件位于：

```text
~/.super-helper/config.json
```

本地密钥不会写入 `config.json`，会通过 `SecretRef` 引用：

```text
~/.super-helper/secrets.json
```

Onboarding 草稿、运行记录和可恢复进度位于：

```text
~/.super-helper/onboarding/
```

知识库默认位于配置的 `knowledge.rootDir` 下，并按 workspace key 隔离。Setup Dashboard 中填写的知识库根目录会成为实际落盘根目录。典型结构如下：

```text
<knowledge-root>/
  knowledge/
    _sources/
    _taxonomy/
    faq/
    runbooks/
    tickets/
    whitepapers/
    glossary/
    modules/
    indexes/
```

`knowledge/_sources/` 保存原始源文件；`faq/`、`runbooks/`、`whitepapers/`、`modules/`、`glossary/`、`tickets/` 是可维护的结构化 Markdown 知识；`knowledge/indexes/` 保存可重建的关键词索引、向量索引和构建报告。

## 检索流程

运行时知识检索使用多路召回流程：

```text
BM25 召回 + Embedding 向量召回 + 兼容关键词召回
  -> 候选融合与去重
  -> 可选 Rerank 重排序
  -> Evidence Judge 判断是否足够回答
  -> 不足时升级到 Claude Code 只读诊断
```

召回编排位于 `src/retrieval/`。Embedding 和 Rerank 是同级 provider 能力，分别位于 `src/providers/embedding/` 和 `src/providers/rerank/`；旧 `src/embedding/` 仅保留兼容导出。当前真实 provider 是 SiliconFlow，同时保留 fake provider 便于测试。

## 高级 CLI

Setup Dashboard 是默认流程；下面命令保留给维护、排障和 CI 使用。

知识库维护：

```bash
pnpm knowledge:init -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:update -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:extract -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:normalize -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:slice -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:audit -- --workspace /path/to/project --knowledge-root /path/to/knowledge
pnpm knowledge:review -- --workspace /path/to/project --knowledge-root /path/to/knowledge --source-id <source-id> --action approve --reviewer <name>
pnpm knowledge:publish -- --workspace /path/to/project --knowledge-root /path/to/knowledge --quality-gate warn
```

使用 npm 时，把 `pnpm <script>` 换成 `npm run <script>` 即可，例如：

```bash
npm run knowledge:init -- --workspace /path/to/project --knowledge-root /path/to/knowledge
```

从命令行检索：

```bash
pnpm build
node dist/cli.js knowledge search \
  --workspace /path/to/project \
  --knowledge-root /path/to/knowledge \
  --query "这里写你的问题"

node dist/cli.js retrieval search \
  --workspace /path/to/project \
  --knowledge-root /path/to/knowledge \
  --query "这里写你的问题"

node dist/cli.js retrieval debug \
  --workspace /path/to/project \
  --knowledge-root /path/to/knowledge \
  --query "这里写你的问题"
```

模型连通性检查：

```bash
node dist/cli.js embedding test --enable --provider siliconflow --api-key-env SILICONFLOW_API_KEY
node dist/cli.js rerank test --enable --provider siliconflow --api-key-env SILICONFLOW_API_KEY
```

真实密钥必须留在仓库外。不要把 `.key.yaml`、环境变量值、Authorization header 或任何明文 API key 写入 README、源码、测试、报告或提交产物。

## 开发

改代码前先阅读：

- [仓库开发规则](AGENTS.md)
- [开发标准](docs/development-standards.md)
- [技术架构](docs/technical-architecture.md)
- [Agent 设计](docs/agent-design.md)
- [产品 Agent 说明](src/agents/README.md)
- [主 Agent 配置](src/agents/main.md)

常用验证：

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

主要实现入口：

- Setup Dashboard、草稿、运行记录、进度和配置提交在 `src/onboarding/`。
- HTTP 启动和路由组合在 `src/gateway/http-server.ts`，`src/server.ts` 只是兼容导出。
- 设置保存、SecretRef 应用、public settings 映射和 provider/model smoke test 编排在 `src/settings/`。
- CLI 主分发在 `src/cli/main.ts`，复杂命令适配器使用 `src/cli/command-*` 命名。
- 产品 Agent 配置在 `src/agents/`，阶段配对在 `src/agents/registry.json`。
- 运行时编排在 `src/runtime/diagnostic-runtime.ts`，`src/agent.ts` 只是兼容门面。
- 多策略召回、候选融合、可选 rerank 和 retrieval trace 在 `src/retrieval/`。
- Embedding/Rerank provider 适配在 `src/providers/embedding/` 和 `src/providers/rerank/`。
- 企业知识库资产、pipeline 和可重建索引 artifact 在 `src/knowledge/`。
- Claude Code 诊断工作器内部实现位于 `src/workers/claude/`，`src/claude-worker.ts` 只是兼容导出。
- 诊断案例仓库和诊断上下文工具在 `src/sessions/`。
- 诊断日志抽屉的展示转换在 `src/observability/log-blocks.ts`。
