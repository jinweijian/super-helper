## Why

`super helper` 现在以当前 workspace 代码仓库为主要诊断对象，用户问题通过 Preflight 后通常会升级到 Claude Code / CC worker 做代码检查。产品下一阶段需要把 workspace 升级为企业知识库工作区：先检索 FAQ、白皮书、runbook、历史 case、术语表和模块文档，只有在知识证据不足、冲突、过期或问题依赖当前实现时才升级到代码排查。

这个 change 先建立可 review、可分阶段实施的工程规划和行为契约，避免直接把知识库检索逻辑塞进 gateway、worker 或产品 Agent prompt 中，破坏现有 runtime 边界。

## What Changes

- 定义“企业分层知识库优先，必要时再查代码”的目标诊断工作流。
- 定义 Main Agent、Knowledge Router、Knowledge Search Service、Evidence Judge、Case Curator、Knowledge Ingest 与现有 Claude Code / CC worker 的职责边界。
- 设计企业知识库 workspace 目录结构，包含 taxonomy、模块文档、FAQ、runbook、工单、solved/unresolved cases、whitepapers、glossary、repos 和 indexes。
- 设计 Markdown frontmatter 标准和 FAQ、solved case、unresolved case、whitepaper slice、runbook、module overview、glossary term 模板。
- 定义 PDF / 白皮书从原始文件到结构化知识的切割方案：保留 source document，生成人工可维护的 parent slice，再派生机器检索用 evidence chunk。
- 明确“切”和“查”必须一起设计：小 chunk 负责召回，父级 slice 负责解释和回答，原 PDF 负责溯源。
- 分阶段设计检索能力：MVP 仅做 Markdown 读取、frontmatter 解析、模块路由、关键词搜索、metadata 过滤和 evidence pack；后续再引入 BM25、向量检索、hybrid search、reranker、parent-child retrieval 和 GraphRAG。
- 定义 Evidence Judge 的结构化输出和升级到代码排查的规则。
- 定义用户确认已解决后的 Case Curator 沉淀流程，默认 `status: review_required`、`confidence: medium`，并标记索引需要刷新。
- 保留现有 Claude Code / CC worker 行为、`DiagnosticRequest` / `DiagnosticResult` / Evidence Review contract、case JSON 兼容性和 HTTP API response shape。
- 本 change 只规划，不实现运行时代码。

## Capabilities

### New Capabilities

- `layered-knowledge-diagnosis`: 定义企业知识库优先的分层诊断流程、知识证据包、证据充分性判断、代码升级条件和 solved case 沉淀契约。

### Modified Capabilities

- None. 当前仓库没有归档到 `openspec/specs/` 的主线 spec；已有历史 change 的 runtime 与 multi-agent 约束将作为本 change 的设计输入，不在本次直接修改其 spec。

## Impact

- 后续实现涉及的主要模块：
  - `src/runtime/`: 接入知识路由、知识搜索、Evidence Judge、case 沉淀触发与事件记录编排。
  - `src/agents/`: 新增或调整 Knowledge Router、Evidence Judge、Case Curator 等产品 Agent 配置，并登记到 `registry.json`。
  - `src/sessions/`: 扩展 case context 构建，使知识证据和历史 case 证据能进入诊断上下文，但不得破坏持久化 case JSON shape。
  - `src/workers/`: 保留 `DiagnosticWorker` / Claude adapter 作为代码排查升级工具，不承载知识库搜索或用户最终回复。
  - `src/domain.ts`: 后续可能新增知识文档、evidence pack、judge result、curation request 等类型。
  - `src/observability/`: 后续增加知识检索、证据判断、代码升级、case 沉淀等日志阶段。
  - `src/gateway/`: 仅在需要 API 暴露知识库、模板或沉淀确认时做 DTO/route 接入，不承载业务决策。
- 后续新增 workspace 内容目录：
  - `knowledge/`
  - `knowledge/_sources/`
  - `knowledge/_taxonomy/`
  - `knowledge/modules/`
  - `knowledge/faq/`
  - `knowledge/runbooks/`
  - `knowledge/tickets/solved-cases/`
  - `knowledge/tickets/unresolved-cases/`
  - `knowledge/whitepapers/`
  - `knowledge/glossary/`
  - `knowledge/indexes/`
  - `repos/`
- MVP 不引入外部检索依赖，不要求运行时依赖 Obsidian，不改变现有 CLI、HTTP API、storage shape 或 Claude Code 安全策略。
