# super helper

`super helper` 是一个以聊天为入口的本地诊断助手。它可以围绕任意项目工作区、可配置 MCP 工具和企业知识库，帮助用户整理问题、检索证据、调用只读诊断工具，并输出经过证据审核的结论。

产品里刻意拆开了两类职责：

- `super helper Agent` 负责与用户对话、判断信息是否足够、必要时追问、审核证据、解释结论。
- Claude Code 是被 Agent 调用的诊断工具。在当前最小可用版里，Claude Code 不直接面向用户回复。

建议先阅读这些文档：

开发规范：

- [仓库开发规则](AGENTS.md)：AI 编程代理和开发者修改本仓库时必须遵守的规则。
- [开发标准](docs/development-standards.md)：模块边界、契约、反模式和最低验证要求。

产品 Agent 行为：

- [产品 Agent 说明](src/agents/README.md)：主 Agent 和子 Agent 配置的存放位置。
- [主 Agent 配置](src/agents/main.md)：运行时面向用户的主 Agent 行为。
- [产品需求](docs/product-requirements.md)
- [Agent 设计](docs/agent-design.md)
- [技术架构](docs/technical-architecture.md)
- [命令白名单](docs/command-whitelist.md)
- [MVP 路线图](docs/mvp-roadmap.md)

## 开发

改代码前先阅读 [开发标准](docs/development-standards.md)。本项目要求按模块边界开发，不要把逻辑随手塞到入口文件或路由里。

```bash
pnpm install
pnpm lint
pnpm typecheck
```

主要实现入口：

- 产品 Agent 配置在 `src/agents/`，阶段配对在 `src/agents/registry.json`。
- 运行时编排在 `src/runtime/diagnostic-runtime.ts`，`src/agent.ts` 只是兼容门面。
- 企业知识库工具在 `src/knowledge/`。
- HTTP 启动和路由组合在 `src/gateway/http-server.ts`，`src/server.ts` 只是兼容导出。
- Claude Code 诊断工作器内部实现位于 `src/workers/claude/`，`src/claude-worker.ts` 只是兼容导出。
- 诊断案例仓库和诊断上下文工具在 `src/sessions/`。
- 诊断日志抽屉的展示转换在 `src/observability/log-blocks.ts`。

## 本地运行

下面是一条从 0 搭建到可验证的本地流程。示例都假设你在本仓库根目录执行命令：

```bash
pnpm install
pnpm build
node dist/cli.js init
```

第一次初始化会创建 `~/.super-helper/config.json`。默认情况下，诊断案例记忆会按工作区隔离存储在 `~/.super-helper/` 下的子目录中，所以不同 `--workspace` 启动的服务不会混用会话。

配置工作区：

```bash
node dist/cli.js workspace set --path /Users/king/my/super-helper --name "super-helper"
```

启动服务：

```bash
node dist/cli.js dev --workspace /Users/king/my/super-helper
```

然后打开终端打印出来的本地地址。

点击左上角 `super helper` 品牌名可以打开本地设置面板。设置面板可以保存 Agent 模型提供方、测试模型连通性、保存向量模型与重排序模型设置、执行 `测试 Embedding` / `测试 Rerank`，并查看从 `src/agents/` 加载的只读多 Agent 配置。

## 未来 npm 安装形态

发布以后，预期使用方式如下：

```bash
npm install -g super-helper
super-helper init
super-helper knowledge init --workspace /path/to/your/workspace
super-helper knowledge update --workspace /path/to/your/workspace
super-helper dev --workspace /path/to/your/project
```

## 企业知识库最小可用版

当前知识库是本地文件形态。运行时检索仍然基于关键词和 frontmatter 元数据。向量文件只是可选的派生产物，用来验证模型提供方和未来检索路径；本轮不会引入向量数据库、GraphRAG、Obsidian 运行时依赖，也不会把重排序接入运行时排序。

初始化知识库结构：

```bash
node dist/cli.js knowledge init \
  --workspace /Users/king/my/super-helper \
  --knowledge-root ~/.super-helper/knowledge \
  --source-dir ~/Documents/knowledge
```

该命令会创建：

```text
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

`knowledge init` 会执行导入、提取、标准化、草稿切片、审计，并为已经发布的正式文档建立索引。它不会自动把未审核草稿发布为可用知识。依赖导入文档回答问题前，需要先复核和发布：

```bash
node dist/cli.js knowledge review --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge --source-id <source-id> --action approve --reviewer <your-name>
node dist/cli.js knowledge publish --workspace /Users/king/my/super-helper --knowledge-root ~/.super-helper/knowledge --source-id <source-id> --quality-gate warn
```

发布或编辑 Markdown 知识后，重建关键词索引：

```bash
node dist/cli.js knowledge update \
  --workspace /Users/king/my/super-helper \
  --knowledge-root ~/.super-helper/knowledge
```

从命令行检索本地知识库：

```bash
node dist/cli.js knowledge search \
  --workspace /Users/king/my/super-helper \
  --knowledge-root ~/.super-helper/knowledge \
  --query "AI伴学助手学习日晚上8点未完成任务会怎么提醒？"
```

白皮书 PDF 和原始源文件会保存在 `knowledge/_sources/`。人工维护的 Markdown 父切片位于 `knowledge/whitepapers/`、`knowledge/modules/`、`knowledge/faq/`、`knowledge/runbooks/` 和 `knowledge/tickets/`。`knowledge/indexes/chunks.jsonl` 是可重建的召回索引。

索引完成后运行本地验收：

```bash
node dist/cli.js accept knowledge \
  --workspace /Users/king/my/super-helper \
  --knowledge-root ~/.super-helper/knowledge \
  --mock-worker
```

验收会覆盖：知识库直接命中、EduSoho 白皮书命中、无命中深度查询升级、实现细节问题升级到只读代码排查提示，以及已解决案例沉淀冒烟测试。

## SiliconFlow 向量与重排序检查

向量模型和重排序模型配置独立于 Agent 聊天模型。默认配置保持二者关闭，本轮唯一真实实现的提供方是 SiliconFlow，并且只保存环境变量名：

```json
{
  "embedding": {
    "enabled": false,
    "provider": "siliconflow",
    "model": "Qwen/Qwen3-Embedding-0.6B",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "apiKeyEnv": "SILICONFLOW_API_KEY",
    "dimensions": 1024,
    "distance": "cosine"
  },
  "rerank": {
    "enabled": false,
    "provider": "siliconflow",
    "model": "BAAI/bge-reranker-v2-m3",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "apiKeyEnv": "SILICONFLOW_API_KEY"
  }
}
```

真实密钥必须留在仓库外：

```bash
export SILICONFLOW_API_KEY="..."
```

本地 `.key` 文件只能用于手工 shell 测试。不要把其中内容写入 `README.md`、`config.json`、源码、测试、报告或任何提交产物。

验证 SiliconFlow 向量模型：

```bash
node dist/cli.js embedding test \
  --enable \
  --provider siliconflow \
  --model Qwen/Qwen3-Embedding-0.6B \
  --base-url https://api.siliconflow.cn/v1 \
  --api-key-env SILICONFLOW_API_KEY \
  --dimensions 1024
```

预期输出形态：

```text
embedding model ok: provider=siliconflow model=Qwen/Qwen3-Embedding-0.6B dimensions=1024 distance=cosine
```

验证 SiliconFlow 重排序模型连通性：

```bash
node dist/cli.js rerank test \
  --enable \
  --provider siliconflow \
  --model BAAI/bge-reranker-v2-m3 \
  --base-url https://api.siliconflow.cn/v1 \
  --api-key-env SILICONFLOW_API_KEY
```

重排序目前只是连通性和模型正确性检测，不参与知识库检索排序。

执行 `knowledge update` 后，可以构建本地向量产物：

```bash
node dist/cli.js knowledge vector build \
  --workspace /Users/king/my/super-helper \
  --knowledge-root ~/.super-helper/knowledge \
  --enable \
  --provider siliconflow \
  --model Qwen/Qwen3-Embedding-0.6B \
  --base-url https://api.siliconflow.cn/v1 \
  --api-key-env SILICONFLOW_API_KEY \
  --dimensions 1024 \
  --batch-size 16 \
  --timeout-ms 60000
```

该命令会写入：

```text
knowledge/indexes/vectors.jsonl
knowledge/indexes/vector-manifest.json
knowledge/indexes/vector-build-report.json
```

向量构建报告会记录数量、提供方、模型、维度、距离度量、产物路径和安全失败信息。报告不得存储 API 密钥、请求头、原始切片文本或提供方原始响应。

### 扩展向量模型提供方

后续新增其他向量模型提供方时，按这个顺序做：

1. 先核对当前官方文档，并在 OpenSpec 变更记录里记录接口地址、鉴权方式、请求字段、响应中的向量路径、维度行为、批量限制和错误格式。
2. 在 `src/embedding/` 下新增提供方适配器。
3. 通过向量模型提供方工厂注册，不要从 `src/knowledge/` 直接导入提供方类。
4. 为成功、缺少凭证、响应格式错误、提供方错误、超时、限流和维度不匹配增加模拟请求测试。
5. 只有当适配器已经有不打印密钥和原始向量的冒烟测试命令后，才补 README 和配置示例。

Qwen、Gemini 和 MiniMax 本轮故意不实现。等官方文档和接入渠道确认后，再用新的范围明确变更增加。重排序也遵循同样边界：当前 SiliconFlow 重排序命令只验证连通性和模型正确性；真正的重排序、回退行为和证据判断 Agent 集成应由后续检索变更负责。

## Agent 模型配置

Agent 可以使用兼容 OpenAI Chat Completions 的模型提供方做两件事：

- 预检：判断应该追问用户还是分发给 Claude Code。
- 审核：审核 Claude Code 结果，并生成最终用户可见回复。

如果没有配置模型，super helper 会退回到确定性的本地规则。

示例 `~/.super-helper/config.json` 片段：

```json
{
  "agent": {
    "modelProvider": "default",
    "useModelForPreflight": true
  },
  "models": {
    "providers": {
      "default": {
        "type": "openai-compatible",
        "baseUrl": "https://api.example.com/v1",
        "apiKeyEnv": "SUPPER_HELPER_API_KEY",
        "model": "your-model-id",
        "temperature": 0
      }
    }
  }
}
```

Claude Code 仍然只是诊断工作器。是否调用它由 Agent 决定。

MiniMax 示例：

```json
{
  "agent": {
    "modelProvider": "minimax",
    "useModelForPreflight": true
  },
  "models": {
    "providers": {
      "minimax": {
        "type": "openai-compatible",
        "baseUrl": "https://api.minimaxi.com/v1",
        "api": "openai-completions",
        "apiKeyEnv": "MINIMAX_API_KEY",
        "model": "MiniMax-M3",
        "temperature": 0,
        "maxTokens": 1200,
        "contextWindowTokens": 1000000
      }
    }
  }
}
```

真实密钥放在环境变量里：

```bash
export MINIMAX_API_KEY="..."
```

如果启动 `super-helper` 的命令行环境中没有 `MINIMAX_API_KEY`，Agent 模型会报 `Missing API key for model MiniMax-M3`，并回退到本地预检规则。诊断真实问题前，建议先在设置面板点击 `测试模型` 确认模型可用。

上下文窗口计量会优先使用当前模型提供方的 `contextWindowTokens`。如果提供方未配置该值，super helper 会依次使用内置模型默认值和 `agent.contextWindowTokens`。

也可以用 CLI 配置模型：

```bash
super-helper model set default \
  --base-url https://api.example.com/v1 \
  --model your-model-id \
  --api-key-env SUPPER_HELPER_API_KEY
```

## 工作区与 MCP 配置

```bash
super-helper workspace set --path /path/to/your/project --name "My Project"
super-helper mcp add readonly-db --protocol stdio --permission read_only --config-json '{"command":"node","args":["server.js"]}'
```
