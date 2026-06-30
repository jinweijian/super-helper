## Context

### 当前架构调研

当前项目已经完成了从“大文件 Agent”到模块化 runtime 的第一轮重构，核心链路是：

```text
Gateway chat route
  -> SuperHelperAgent facade
  -> DiagnosticRuntime.startUserTurn
  -> Experience Agent
  -> Preflight Gate
  -> DiagnosticRequest builder
  -> DiagnosticWorker port
  -> Claude Code Worker
  -> Review Gate
  -> Presenter
  -> RuntimeEventRecorder
  -> CaseRepository
```

当前 Agent 配置位于 `src/agents/`：

- `main.md`: 主 Agent，负责用户回合、证据边界和最终回复责任。
- `input-review.md`: 输入审核与 Preflight Gate Agent。
- `experience.md`: 历史经验复用 Agent。
- `output-review.md`: 证据与输出审核 Agent。
- `presentation.md`: persona-aware presentation Agent。
- `registry.json`: runtime stage 到 Agent 配置文件的配对表。

Main Agent 当前工作方式：

- 收到用户自然语言输入后，先记录 case/message/log。
- Experience Agent 在同 workspace 的历史 case 中做保守相似匹配，命中时生成 `history` evidence，并仍经过 Output Review 和 Presentation。
- Preflight Gate 判断是否信息足够，足够则构造 `DiagnosticRequest`。
- `DiagnosticRequest` 通过 `DiagnosticWorker` port 派发给 Claude Code worker。
- Claude worker 只允许只读工具 `Read`、`Glob`、`Grep`，输出结构化 `DiagnosticResult`，不能直接回复用户。
- Review Gate / Output Review 检查 evidence、claim、missingInfo 和 recommendedNextAction。
- Presenter 生成中文用户回复，不新增事实。

当前 workspace 假设：

- `WorkspaceConfig.rootPath` 是任意项目代码库根目录。
- workspace 可包含 `CLAUDE.md` 指导 Claude Code 检查项目，但它不是 super helper 产品 Agent 配置。
- 当前 worker prompt 假设“workspace inspection”主要是 README、docs、specs、routes、services、jobs、配置和源码文件的只读检查。
- 现有代码还没有把 workspace 作为企业知识库工作区建模，也没有独立的 `knowledge/` 目录、taxonomy、知识文档 schema 或索引状态。

当前 Claude Code / CC worker 调用方式：

- `src/workers/diagnostic-worker.ts` 定义稳定 port：`diagnose(request: DiagnosticRequest)`。
- `src/workers/claude/claude-code-worker.ts` 查找 workspace，构造 Claude CLI 参数，按 `claudeSessionId` 串行执行。
- `claude-prompts.ts` 构造系统 prompt 和用户 payload，要求返回 `DiagnosticResult` JSON。
- `claude-policy.ts` 收窄只读工具并校验 host command allowlist。
- `claude-output-parser.ts` 解析 JSON，失败时转换为 partial/escalate 的结构化结果。

### 附件技术方案补充

用户提供的《super-helper 企业分层诊断系统开发与技术实现方案》进一步明确：当前缺口不是 Claude Code 本身不可用，而是 runtime 主链路尚未把 knowledge-first、deep query、query correction 接入。落地时应优先在现有架构上补齐：

- Knowledge Router runtime stage：读取 taxonomy 与别名，输出 module、intent、keywords、source type、code escalation signals。
- Evidence Judge runtime stage：用结构化 `answer_score` 和风险/冲突/时效规则判断是否可由知识直接回答。
- Deep Query Planner：知识不足时把 evidence gaps 和 clue signals 转成带线索的只读 `DiagnosticRequest`，让 Claude Code 使用 Read/Glob/Grep 做静态调查。
- Query Correction：无命中、模糊命中或深查方向失败时，按别名扩展、邻接模块、source_type 扩展、artifact family pivot 进行回退，最后才追问或人工升级。
- 多格式 source ingest：普通 docx/Markdown 可由本地轻量解析器入库；复杂 PDF、扫描件、表格文件后续可接 MarkItDown、Docling、Unstructured 或 LlamaParse，但 MVP 不引入这些运行时依赖。
- `knowledge:init` / `knowledge:update` 应保留现有命令形态，并生成 `ingest-report.json`，让切割质量可审核。

附件还指出配置测试能成功不等于本地会话会调用远程模型：必须确保 `agent.modelProvider` 被激活，否则 Preflight/Output Review 的远程模型不会被调用。

当前 experience / history / evidence / diagnostic request 机制：

- `EvidenceKind` 已包含 `knowledge` 和 `history`，为知识库证据预留了类型。
- `DiagnosticRequest` 已包含 `knownFacts`、`unknowns`、`constraints`、`allowedMcpToolIds` 和 bounded `context`。
- `DiagnosticResult` 已包含 `evidence`、`claims`、`missingInfo` 和 `recommendedNextAction`。
- `Experience Agent` 只复用本地 case session 历史，不读取企业知识库 Markdown。
- `Review Gate` 已有“不接受无 evidenceIds 的 fact”的最低规则。
- `CaseRepository` 和 `FileMemoryStore` 持久化 case JSON，是长期会话上下文来源。
- `RuntimeEventRecorder` 记录可观测日志阶段，但还没有知识检索、证据判断、代码升级、case 沉淀阶段。

新能力应该接入的位置：

- 新增 `src/knowledge/` 模块，拥有知识 workspace 发现、taxonomy 读取、Markdown/frontmatter 解析、基础搜索、模板和索引状态。这个模块不得直接回复用户，不得调用 Claude Code。
- `src/runtime/` 在 Experience Agent 之后、Preflight/代码派发之前接入 Knowledge Router、Knowledge Search Service 和 Evidence Judge。runtime 负责“先知识、后代码”的编排。
- `src/agents/` 增加 Knowledge Router、Evidence Judge、Case Curator 的产品 Agent 配置，并在 `registry.json` 增加 stage 配对。
- `src/sessions/` 扩展上下文构建，允许把 knowledge evidence pack 和 solved case evidence 作为 bounded context 输入后续代码排查。
- `src/workers/` 保持代码排查工具职责，只有 Evidence Judge 决定需要代码升级时才调用。
- `src/observability/` 增加知识检索、evidence pack、judge result、code escalation、case curation、index dirty 等日志展示。
- `src/gateway/` 只在需要 API 或 UI 入口时承载 DTO 和路由，例如知识库健康检查、模板下载、确认已解决、查看沉淀草稿；不得做业务判断。

必须保留、不能破坏的现有能力：

- 现有 `DiagnosticRequest` / `DiagnosticResult` / Evidence Review contract。
- Claude Code worker 作为只读代码排查工具，不直接回复用户。
- `src/agent.ts`、`src/server.ts`、`src/claude-worker.ts` 继续保持薄兼容入口。
- 现有 `/api/chat`、`/api/session`、`/api/sessions`、`/api/settings`、`/api/logs` response shape 兼容性。
- 现有 case JSON shape 兼容性；如需新增字段，必须可选、可迁移、可测试。
- 同 case 串行处理、不同 case 可并发。
- Agent 最终回复必须基于证据，区分事实、推断、假设、未知。

## Goals / Non-Goals

**Goals:**

- 把产品方向从“代码诊断助手”升级为“企业知识库优先的分层诊断助手”。
- 建立知识库 workspace 目录、taxonomy、frontmatter schema、模板和索引状态约定。
- 定义 MVP 知识检索方案：Markdown 文件读取、frontmatter 解析、模块路由、关键词搜索、metadata 过滤、evidence pack 返回。
- 定义 Evidence Judge 对“可直接回答”与“必须升级到代码”的结构化判断。
- 定义用户确认解决后的 Case Curator solved case 沉淀流程。
- 保持现有 runtime、gateway、worker、session、agent 模块边界清晰。
- 允许后续阶段平滑引入 BM25、向量检索、hybrid search、reranker、parent-child retrieval、GraphRAG。

**Non-Goals:**

- MVP 不做复杂 RAG、embedding、数据库索引、GraphRAG 或在线知识图谱。
- MVP 不依赖 Obsidian；Obsidian 只能作为人工编辑 Markdown 的可选工具。
- 不让 Claude Code 或 MCP 工具直接生成用户最终回复。
- 不改变现有 case JSON 持久化结构，除非后续 implementation change 明确给出迁移策略和测试。
- 不改变 Claude Code 默认只读安全策略。
- 不把知识库搜索逻辑塞进 gateway routes 或 Claude worker adapter。

## Decisions

### 1. 新增 `src/knowledge/` 作为知识库模块

Decision:

- 后续实现应新增 `src/knowledge/`，拥有知识文档、taxonomy、Markdown/frontmatter 解析、搜索、模板和索引状态相关逻辑。
- `src/runtime/` 只编排知识检索流程，不直接遍历文件系统或解析 Markdown。
- `src/agents/` 只存放产品 Agent 配置，不实现搜索。
- `src/workers/` 不承载知识库检索；Claude Code worker 只在需要检查代码实现时被调用。

Rationale:

- 当前模块边界已经强调 runtime 负责编排、workers 负责工具、agents 负责配置。知识库是新的业务能力，需要独立所有权。
- 如果把知识搜索直接写进 runtime，后续 BM25/向量检索/索引会污染 runtime。
- 如果把知识搜索交给 Claude Code，会违背“知识库优先”和“worker 不直接拥有上下文”的设计。

Alternatives considered:

- 让 Claude Code 先读 `knowledge/` 再读代码。拒绝：这仍然是一上来调用代码 worker，无法降低成本，也无法在 runtime 中做 evidence sufficiency 判断。
- 把知识搜索做成 MCP tool。可作为后续扩展，但 MVP 本地 Markdown 搜索不应依赖外部 MCP。

### 2. 分层诊断工作流

Target workflow:

```text
用户问题
  -> Main Agent 接收输入
  -> 问题归一化
  -> Knowledge Router 识别 module / intent / source filters
  -> Knowledge Search Service 搜索企业知识库
  -> Evidence Pack 返回候选证据
  -> Evidence Judge 判断证据是否足够
     -> 足够：Output Review + Presentation 直接回答
     -> 不足/冲突/过期/实现相关：构造 DiagnosticRequest 并升级到 Claude Code / CC worker
  -> Review Gate 审核最终 evidence + claims
  -> Presenter 给出带证据的中文回复
  -> 用户确认已解决
  -> Case Curator 生成 solved case Markdown
  -> 保存到 knowledge/tickets/solved-cases/
  -> 标记 review_required 和 index dirty
```

Stage ownership:

- Main Agent: 用户回合责任、最终回复责任、证据边界。
- Knowledge Router: 归一化问题，识别业务模块、意图、关键词、相关术语、候选 source_type。
- Knowledge Search Service: 读取 taxonomy 和 Markdown，执行 MVP 搜索，返回 evidence pack。
- Evidence Judge: 判断知识证据是否足够、是否需要代码升级、是否存在风险或冲突。
- Claude Code / CC worker: 仅在需要当前代码证据时做只读代码排查。
- Case Curator: 用户确认解决后沉淀结构化 solved case。
- Knowledge Ingest: 管理模板、文档校验、索引刷新标记和后续索引构建。

### 3. Agent 配置扩展

后续应在 `src/agents/` 增加：

- `knowledge-router.md`
- `evidence-judge.md`
- `case-curator.md`

并在 `registry.json` 增加 stage：

- `knowledge_router`
- `evidence_judge`
- `case_curator`

配置要求：

- 每个 Agent 配置必须写明 role、responsibility、input contract、output contract、allowed dependencies、是否允许用户可见文本。
- Knowledge Router 和 Evidence Judge 默认不直接产生用户可见最终回复。
- Case Curator 生成的是知识库草稿，不是用户最终回复。
- Output Review 和 Presentation 继续负责最终用户回复。

### 4. Workspace 目录结构

企业知识库 workspace 建议结构：

```text
workspace/
  source-assets/
    whitepapers/
    tickets/
    faq/
    exports/
  knowledge/
    _sources/
      whitepapers/
        <source-document>.pdf
        <source-document>.meta.json
    _taxonomy/
      modules.yaml
      aliases.yaml
      intents.yaml
      source-types.yaml
    modules/
      <module-id>/
        overview.md
        decisions/
        notes/
    faq/
      <module-id>/
        *.md
    runbooks/
      <module-id>/
        *.md
    tickets/
      solved-cases/
        <module-id>/
          *.md
      unresolved-cases/
        <module-id>/
          *.md
    whitepapers/
      <product-or-module>/
        *.md
    glossary/
      terms/
        *.md
    indexes/
      manifest.json
      keyword-index.json
      chunks.jsonl
      dirty.flag
  repos/
    <repo-name>/
```

Directory purposes:

- `knowledge/`: 企业知识库根目录，运行时只依赖普通文件系统和 Markdown，不依赖 Obsidian。
- `source-assets/`: 人工投放原始资料的入口层；也允许 CLI 通过 `--source-dir` 指向外部目录，例如 `/Users/king/Documents/knowledge/`。
- `knowledge/_sources/`: 原始资料归档目录，例如 PDF 白皮书、导入元数据和文件 hash。原始资料用于溯源，不直接作为用户回答材料。
- `knowledge/_sources/whitepapers/`: 原始白皮书 PDF 和对应 `.meta.json`，记录来源 URL、下载时间、文件 hash、版本、页数、导入工具版本。
- `knowledge/_taxonomy/`: 模块、别名、意图、source_type 的受控词表。
- `modules.yaml`: 业务模块 ID、名称、owner、相关 repo、关键词、版本范围。
- `aliases.yaml`: 用户常用词、产品名、旧名称、英文/中文别名到模块或术语的映射。
- `intents.yaml`: troubleshooting、how_to、product_rule、implementation_detail、data_fix、security_review 等意图定义。
- `source-types.yaml`: FAQ、runbook、solved_case、unresolved_case、whitepaper、glossary、module_doc、ticket 等来源类型定义和默认权重。
- `knowledge/modules/`: 模块说明、边界、上下游、关键业务规则。
- `knowledge/faq/`: 高频问答，适合直接回答操作流程、产品规则和常见问题。
- `knowledge/runbooks/`: 排查手册、操作步骤、应急流程、升级条件。
- `knowledge/tickets/solved-cases/`: 已解决 case，来自人工沉淀或 Case Curator 草稿。
- `knowledge/tickets/unresolved-cases/`: 未解决或待跟进 case，不能作为高置信最终答案。
- `knowledge/whitepapers/`: 产品白皮书的结构化 parent slice。它是人工可维护的最小知识单元，不是机械 chunk。
- `knowledge/glossary/`: 术语、缩写、业务对象、配置项说明。
- `knowledge/indexes/`: MVP 可选的索引 manifest、关键词索引、`chunks.jsonl` 和 dirty 标记。索引与 chunk 是派生物，可删除重建。
- `repos/`: 代码仓库目录。只有 Evidence Judge 决定需要代码升级时，Claude Code 才检查这里或配置的 repo root。

### 5. Markdown frontmatter schema

所有知识文档必须使用 YAML frontmatter。最低字段：

```yaml
---
id: kb_faq_course_publish_001
title: 课程发布后为什么学员看不到
type: faq
module: course
intent: troubleshooting
source_type: faq
confidence: high
status: active
visibility: internal
product_versions:
  - ">=2025.10"
related_terms:
  - 课程发布
  - 可见范围
related_repos:
  - course-service
last_verified_at: 2026-06-13
owner: support-platform
---
```

Recommended fields:

```yaml
severity: normal
applies_to:
  environments: [prod, staging]
  tenants: []
  roles: [admin, teacher, learner]
not_applies_to: []
related_docs: []
related_cases: []
related_code_paths: []
source_document: null
source_document_id: null
source_pages: []
section_path: []
chunking_strategy: null
supersedes: []
superseded_by: null
review_cycle_days: 90
created_at: 2026-06-13
updated_at: 2026-06-13
tags: []
```

Field rules:

- `id` 必须全局唯一，建议按 `kb_<type>_<module>_<slug>` 命名。
- `type` 是文档模板类型，例如 `faq`、`solved_case`、`unresolved_case`、`whitepaper_slice`、`runbook`、`module_overview`、`glossary_term`。
- `module` 必须来自 `knowledge/_taxonomy/modules.yaml`。
- `intent` 必须来自 `knowledge/_taxonomy/intents.yaml`。
- `source_type` 必须来自 `knowledge/_taxonomy/source-types.yaml`。
- `confidence` 只能是 `low`、`medium`、`high`。
- `status` 只能是 `draft`、`review_required`、`active`、`deprecated`、`archived`。
- `visibility` 只能是 `internal`、`support`、`customer_safe`、`restricted`。
- `last_verified_at` 用 ISO date，不确定时不得填未来日期。
- `owner` 必须可追责到团队或岗位。
- `source_document` 指向原始 PDF 或来源文件路径，适用于 whitepaper、导入文档和外部资料。
- `source_pages` 记录原始 PDF 页码范围，必须是可追溯的页码数组。
- `section_path` 记录原始文档层级，例如 `["课程管理", "发布与可见性", "核心规则"]`。
- `chunking_strategy` 记录该文档派生检索 chunk 的策略名称和版本，便于重建索引。

### 6. Knowledge document templates

FAQ template:

```markdown
---
id: kb_faq_<module>_<slug>
title: <问题标题>
type: faq
module: <module-id>
intent: <intent-id>
source_type: faq
confidence: medium
status: review_required
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: <YYYY-MM-DD>
owner: <team-or-role>
---

# <问题标题>

## 问题

<用户常见问法>

## 答案

<基于证据的简洁答案>

## 适用范围

<适用版本、角色、环境、模块>

## 不适用范围

<不适用情况>

## 证据

- <来源文档、runbook、case 或代码路径>

## 需要升级到代码排查的情况

- <触发条件>
```

Solved case template:

```markdown
---
id: kb_case_solved_<module>_<yyyymmdd>_<slug>
title: <已解决问题标题>
type: solved_case
module: <module-id>
intent: troubleshooting
source_type: solved_case
confidence: medium
status: review_required
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: <YYYY-MM-DD>
owner: <team-or-role>
---

# <已解决问题标题>

## 用户原始问题

<原始输入>

## 归一化问题

<Case Curator 归一化后的问题>

## 模块与意图

- 模块：<module>
- 意图：<intent>

## 环境信息

<租户、版本、角色、时间范围、影响范围；未知项必须标记未知>

## 使用过的证据

- <evidence id/source/summary/confidence>

## 排查过程

1. <步骤>

## 根因

<事实、推断和未知分开写>

## 解决方案

<已验证方案>

## 适用范围

<适用条件>

## 不适用范围

<不适用条件>

## 相关代码路径

- <repo/path>

## 用户最终确认

<用户确认已解决的原话或确认事件>

## 后续复核

- 默认状态：review_required
- 建议 owner 复核项：<...>
```

Unresolved case template:

```markdown
---
id: kb_case_unresolved_<module>_<yyyymmdd>_<slug>
title: <未解决问题标题>
type: unresolved_case
module: <module-id>
intent: troubleshooting
source_type: unresolved_case
confidence: low
status: review_required
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: <YYYY-MM-DD>
owner: <team-or-role>
---

# <未解决问题标题>

## 用户原始问题

## 已知事实

## 未知项

## 已尝试排查

## 暂时假设

## 阻塞原因

## 下一步建议

## 不能作为结论复用的原因
```

Whitepaper slice template:

```markdown
---
id: kb_whitepaper_<module>_<slug>
title: <白皮书片段标题>
type: whitepaper_slice
module: <module-id>
intent: product_rule
source_type: whitepaper
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: <YYYY-MM-DD>
owner: <team-or-role>
source_document: <原始白皮书名称或路径>
source_document_id: <source-document-id>
source_pages: []
section_path: []
chunking_strategy: semantic-section-v1
---

# <白皮书片段标题>

## 可回答的问题

- <这个切片适合回答的用户问法>

## 核心规则

## 背景说明

## 适用范围

## 不适用范围

## 例外情况

## 适用版本

## 与其他模块关系

## 原文来源

- 原始文件：<source_document>
- 页码：<source_pages>
- 章节路径：<section_path>
```

Runbook template:

```markdown
---
id: kb_runbook_<module>_<slug>
title: <排查手册标题>
type: runbook
module: <module-id>
intent: troubleshooting
source_type: runbook
confidence: high
status: active
visibility: restricted
product_versions: []
related_terms: []
related_repos: []
last_verified_at: <YYYY-MM-DD>
owner: <team-or-role>
severity: normal
---

# <排查手册标题>

## 触发条件

## 快速判断

## 排查步骤

1. <只读检查步骤>

## 升级条件

## 风险与权限边界

## 证据记录格式

## 回滚或人工处理建议
```

Module overview template:

```markdown
---
id: kb_module_<module>_overview
title: <模块说明>
type: module_overview
module: <module-id>
intent: module_explanation
source_type: module_doc
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: <YYYY-MM-DD>
owner: <team-or-role>
---

# <模块说明>

## 模块职责

## 不负责什么

## 核心业务对象

## 上下游依赖

## 常见问题入口

## 相关仓库
```

Glossary term template:

```markdown
---
id: kb_glossary_<term-slug>
title: <术语>
type: glossary_term
module: <module-id>
intent: term_explanation
source_type: glossary
confidence: medium
status: active
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: <YYYY-MM-DD>
owner: <team-or-role>
aliases: []
---

# <术语>

## 定义

## 常见别名

## 业务含义

## 技术对应物

## 易混淆概念
```

### 7. PDF / 白皮书切割与查询一体化设计

Core principle:

```text
切割不是先把 PDF 机械拆成 chunk。
切割是把原始资料建模成可检索、可回答、可追溯的证据单元。
```

PDF / 白皮书必须用三层模型：

```text
Source Document
  -> Parent Slice
    -> Evidence Chunk
```

Layer responsibilities:

- `Source Document`: 原始 PDF 或来源文件，保留 hash、来源、版本、下载时间、页码和导入元数据。它是溯源依据，不直接进入用户回答。
- `Parent Slice`: 人工可维护的结构化 Markdown 文档，例如一个完整产品规则、流程说明、模块边界、表格解释或白皮书章节。它是回答和 Evidence Judge 的主要上下文。
- `Evidence Chunk`: 从 parent slice 派生的机器检索单元，通常比 slice 小。它负责召回，不独立承担最终解释。

Why this matters:

- 只按固定字数切 chunk 会破坏规则、例外、表格和上下文，容易断章取义。
- 只按大章节建文档会导致检索命中不准，召回噪音高。
- 小 chunk 负责召回、父级 slice 负责解释、原 PDF 负责溯源，可以同时满足查准、答稳和可审计。

切割优先级：

1. 按原始文档结构切：目录、一级标题、二级标题、编号章节、附录、表格标题。
2. 按语义完整性切：一个 slice 应包含完整规则、完整流程、完整定义、完整限制条件或完整例外说明。
3. 按查询意图切：产品规则进入 `whitepaper_slice`，操作步骤进入 `runbook`，常见问法进入 `faq`，术语进入 `glossary_term`，经验进入 `solved_case`。
4. 规则和例外不得被拆成互相不可见的两个证据单元。
5. 表格必须保留表头、单位、适用条件和行含义，不能只按行或页码机械切。

Whitepaper ingestion flow:

```text
下载 PDF
  -> 保存到 knowledge/_sources/whitepapers/
  -> 生成 .meta.json（source id、hash、来源、版本、页数、导入时间）
  -> PDF 转粗 Markdown / text blocks
  -> 识别目录、标题、页码、表格、图片说明
  -> 生成人工可维护 parent slice 草稿
  -> 为每个 slice 补全 frontmatter
  -> 从 slice 派生 evidence chunks 到 indexes/chunks.jsonl
  -> 标记 index manifest / dirty 状态
```

Source metadata shape:

```json
{
  "id": "src_whitepaper_product_v3",
  "source_type": "whitepaper_pdf",
  "path": "knowledge/_sources/whitepapers/product-whitepaper-v3.pdf",
  "sha256": "<file-hash>",
  "title": "Product Whitepaper V3",
  "downloaded_at": "2026-06-13T00:00:00.000Z",
  "source_url": "<optional>",
  "product_versions": [">=2025.10"],
  "page_count": 86,
  "owner": "product-team",
  "ingest_tool_version": "pdf-ingest-v1"
}
```

Evidence chunk shape:

```json
{
  "chunk_id": "chk_course_visibility_rules_001",
  "parent_id": "kb_whitepaper_course_visibility_rules",
  "source": "knowledge/whitepapers/course/course-visibility-rules.md",
  "source_document": "knowledge/_sources/whitepapers/product-whitepaper-v3.pdf",
  "source_pages": [12, 13],
  "module": "course",
  "intent": "product_rule",
  "source_type": "whitepaper",
  "status": "active",
  "confidence": "medium",
  "headings": ["课程管理", "发布与可见性", "核心规则"],
  "keywords": ["课程发布", "学员看不到", "可见范围", "上架时间"],
  "text": "课程必须同时满足发布状态、可见范围、学员权限和上架时间条件，才会在学员端展示。"
}
```

Query-time flow for sliced documents:

```text
用户问题
  -> 问题归一化
  -> module / intent / keywords 识别
  -> metadata filter
  -> evidence chunk 召回
  -> 加载 parent slice
  -> 必要时加载相邻 slice 或 source metadata
  -> Evidence Judge 判断是否足够
```

MVP implementation stance:

- MVP 可以先不实现自动 PDF 解析，但 OpenSpec 必须保留 source/slice/chunk 契约。
- 第一版可人工或半自动把 PDF 转成 parent slice Markdown，再由程序派生 keyword chunks。
- `indexes/chunks.jsonl` 是派生索引，不是知识源；删除后应能从 parent slice 重建。
- 用户回答不得只引用 chunk 文本，必须引用 parent slice 的 evidence summary 和 source document/page。

### 8. MVP 检索方案

MVP search inputs:

```ts
interface KnowledgeSearchQuery {
  workspaceId: string;
  normalizedQuestion: string;
  moduleCandidates: string[];
  intentCandidates: string[];
  keywords: string[];
  sourceTypes: string[];
  productVersions?: string[];
  visibility?: string[];
}
```

MVP steps:

1. 读取 `knowledge/_taxonomy/*.yaml`。
2. 通过 aliases、module keywords、用户关键词做 module routing。
3. 解析候选 Markdown parent slice frontmatter。
4. 如存在 `indexes/chunks.jsonl`，优先用 chunk 召回；否则对 parent slice 的 title、related_terms、正文标题、正文内容做关键词匹配。
5. 按 `module`、`intent`、`source_type`、`status`、`visibility`、`product_versions` 做 metadata 过滤。
6. 对命中 chunk 加载对应 parent slice，并保留 `parent_id`、source document 和 source pages。
7. 按 source_type 权重、confidence、status、last_verified_at 新鲜度、关键词命中密度排序。
8. 返回 bounded evidence pack。

Evidence pack shape:

```json
{
  "query": {
    "normalized_question": "...",
    "module_candidates": ["course"],
    "intent_candidates": ["troubleshooting"],
    "keywords": ["发布", "看不到"]
  },
  "results": [
    {
      "evidence_id": "ev_kb_001",
      "document_id": "kb_faq_course_publish_001",
      "parent_id": "kb_faq_course_publish_001",
      "chunk_id": "chk_course_publish_001",
      "source": "knowledge/faq/course/publish-visible.md",
      "source_document": "knowledge/_sources/whitepapers/product-whitepaper-v3.pdf",
      "source_pages": [12, 13],
      "title": "课程发布后为什么学员看不到",
      "type": "faq",
      "module": "course",
      "intent": "troubleshooting",
      "source_type": "faq",
      "confidence": "high",
      "status": "active",
      "last_verified_at": "2026-06-13",
      "matched_terms": ["发布", "看不到"],
      "summary": "FAQ 明确说明发布状态和可见范围都会影响学员端展示。",
      "excerpt": "<bounded excerpt>"
    }
  ],
  "coverage": {
    "searched_files": 42,
    "matched_files": 3,
    "filtered_out": [
      {"reason": "deprecated", "count": 1}
    ]
  }
}
```

MVP constraints:

- 不做 embedding。
- 不做模型 rerank。
- 不读取 `repos/`，除非 Evidence Judge 决定升级到代码。
- 每次返回 evidence pack 必须有大小上限，避免污染上下文。
- 命中 chunk 后必须加载 parent slice，不能只把 chunk 当作最终回答依据。
- 原始 PDF 只作为溯源来源，不直接塞入回答上下文。
- 对 `restricted` visibility 的文档，用户回复中只展示脱敏摘要，原文进日志或受控 evidence。

### 8.1 入库流水线与 ingest report

MVP 入库支持：

```text
source directory / source-assets
  -> copy original source to knowledge/_sources/<type>/
  -> compute sha256 and source metadata
  -> parse docx/markdown text and headings
  -> generate whitepaper parent slices
  -> generate retrieval chunks
  -> update manifest.json / keyword-index.json / chunks.jsonl
  -> write indexes/ingest-report.json
```

`knowledge:init` 应能初始化目录并在存在 source directory 时导入 source 文档。默认 source directory 可为用户本机 `/Users/king/Documents/knowledge/`，同时支持显式 `--source-dir <path>` 覆盖。原始文件作为 provenance 保存；回答和 Evidence Judge 使用生成的 Markdown parent slice 与 source metadata。

切割审核标准：

- 每个 source document 都有 `.meta.json`，包含 `id`、`path`、`sha256`、`title`、`source_type`、`page_count` 或段落/切片计数、`owner`、`ingest_tool_version`。
- 每个 parent slice 都必须包含 `source_document`、`source_document_id`、`source_pages` 或逻辑 section path、`chunking_strategy`。
- `chunks.jsonl` 中每个 chunk 必须能回溯到 parent slice。
- `ingest-report.json` 必须记录 source 文件数、生成 slice 数、chunk 数、跳过/失败原因和 parser strategy。

Future retrieval phases:

- Phase A: BM25 / inverted index，提高关键词排序质量。
- Phase B: 向量检索，支持语义相似问法。
- Phase C: hybrid search，合并关键词和向量召回。
- Phase D: reranker，对 top candidates 进行重排。
- Phase E: parent-child retrieval，白皮书长文档使用 chunk 命中、父文档解释。
- Phase F: GraphRAG / 知识图谱，显式表达模块、术语、case、repo、runbook 的关系。

### 9. Evidence Judge 规则

Evidence Judge output:

```json
{
  "answerable": true,
  "confidence": "high",
  "need_code_escalation": false,
  "reason": "FAQ 和 runbook 均命中同一模块，内容一致且仍在有效期内。",
  "evidence": ["ev_kb_001", "ev_kb_002"],
  "risks": [],
  "missing_info": [],
  "conflicts": [],
  "recommended_next_action": "final_answer"
}
```

```json
{
  "answerable": false,
  "confidence": "low",
  "need_code_escalation": true,
  "reason": "用户提供了接口路径和 500 报错，知识库没有当前实现证据，必须检查代码路径。",
  "evidence": [],
  "risks": ["implementation_detail"],
  "missing_info": ["当前接口实现", "错误处理逻辑"],
  "conflicts": [],
  "recommended_next_action": "dispatch_code_diagnosis"
}
```

Answer score:

```text
answer_score =
  0.25 * relevance
+ 0.20 * coverage
+ 0.15 * source_authority
+ 0.10 * freshness
+ 0.10 * version_match
+ 0.10 * agreement
+ 0.10 * actionability
- conflict_penalty
- ambiguity_penalty
- risk_penalty
```

Threshold guidance:

- FAQ/how-to：`>= 0.70` 可直接回答，`0.55 ~ 0.70` 追问或补检，低于 `0.55` 升级。
- 普通 troubleshooting：`>= 0.78` 可直接回答，`0.60 ~ 0.78` 追问或补检，低于 `0.60` 升级。
- 支付、权限、安全、数据修复：必须更严格，任何高危不确定都不能直接回答。

Must escalate to code when:

- 用户问的是实现细节、代码路径、调用链、配置读取逻辑或数据结构。
- 用户提供了日志、报错、表名、类名、接口路径、配置项、文件路径。
- 知识库没有命中。
- 知识库结果互相冲突。
- 命中文档 `status` 是 `deprecated`、`archived`，或 `last_verified_at` 超过 review cycle。
- 问题涉及线上事故、数据修复、支付、权限、安全。
- 回答必须验证当前代码实现。
- 高置信文档只覆盖产品规则，但用户问的是“当前系统为什么这样表现”。

Deep Query Planner should add clues:

- `artifact_targets`: scheduler、job、queue、callback、state_machine、permission、payment、config、route、service 等。
- `anchor_terms`: 从用户问题、knowledge route、evidence gaps、相关术语中抽取。
- `likely_paths`: 只作为 Grep/Glob 线索，不作为事实。
- `avoid_assumptions`: 明确禁止把用户假线索直接当根因。

Query Correction should run when:

- knowledge no-hit：扩 aliases、邻接模块、source_type。
- hit but ambiguous：扩大 parent slice context，加入 glossary 相关词。
- deep query failed：从当前 artifact family pivot 到相邻 family，例如 scheduler -> queue/callback/state machine。
- conflict detected：能问一条高价值问题则 ask_user，否则高风险升级人工。

Can answer without code when:

- FAQ 或 runbook 已明确回答。
- 用户问的是产品规则、操作流程、术语解释或模块职责。
- 高置信 solved case 精确命中，并且 module、intent、版本、适用范围仍然匹配。
- 回答不依赖当前代码实现。
- 命中文档之间无冲突，且至少一个来源是 `active`。

Judge scoring guidance:

- `high`: active FAQ/runbook/solved case 精确命中，适用范围明确，未过期，无冲突。
- `medium`: 文档基本命中，但缺少版本、租户、环境或复核时间较旧。
- `low`: 只有 glossary/module overview 泛化命中，或命中文档低置信、待复核、冲突、过期。

### 10. Case Curator 沉淀流程

Trigger:

- 用户明确确认问题已解决，例如“好了”“已解决”“这个方案有效”。
- 或 UI/API 后续提供显式“标记已解决并沉淀”动作。

Flow:

1. Runtime 识别确认解决意图，记录 `case_resolution_confirmed` 日志。
2. Case Curator 读取当前 case 的用户原始问题、归一化问题、模块、意图、环境、evidence、runs、claims、最终回复和用户确认。
3. 生成 solved case Markdown 草稿。
4. 保存到 resolved knowledge workspace 下的 `knowledge/tickets/solved-cases/<module-id>/`。
5. frontmatter 默认 `status: review_required`，不得直接 `active`。
6. frontmatter 默认 `confidence: medium`，不得直接 `high`。
7. 写入 `knowledge/indexes/dirty.flag` 或更新 `manifest.json` 标记需要重新索引。
8. 记录 `case_curator_result` 事件，包含保存路径、文档 id、review_required 状态。

Solved case 至少包含：

- 用户原始问题
- 归一化问题
- 模块
- 意图
- 环境信息
- 使用过的证据
- 排查过程
- 根因
- 解决方案
- 适用范围
- 不适用范围
- 相关代码路径
- 用户最终确认

Safety rules:

- 不把没有 evidenceIds 的 fact 写成根因。
- 对推断、假设、未知必须分区。
- 涉及安全、支付、权限、数据修复的 case 默认 `visibility: restricted`。
- 如果证据不足以沉淀为 solved case，生成 `unresolved_case` 或拒绝沉淀，并说明原因。

### 10. Observability

后续应新增或保留这些日志阶段：

- `knowledge_router_started`
- `knowledge_router_result`
- `knowledge_search_started`
- `knowledge_search_result`
- `evidence_judge_started`
- `evidence_judge_result`
- `knowledge_answer_selected`
- `code_escalation_requested`
- `case_resolution_confirmed`
- `case_curator_started`
- `case_curator_result`
- `knowledge_index_marked_dirty`

这些事件必须带 Agent identity metadata 或 service label，供 `/api/logs` 和 session `agentActivity` 展示。

## Risks / Trade-offs

- [Risk] 知识库目录和 schema 过早复杂化，阻碍 MVP 落地。 -> Mitigation: MVP 只要求最低 frontmatter 字段和 Markdown 搜索；高级索引作为后续阶段。
- [Risk] 旧文档被高置信复用导致错误答案。 -> Mitigation: Evidence Judge 必须检查 `status`、`last_verified_at`、`review_cycle_days` 和冲突。
- [Risk] solved case 自动沉淀把错误结论固化。 -> Mitigation: 默认 `review_required` + `confidence: medium`，review 前不得作为 high confidence active 知识。
- [Risk] runtime 变成知识搜索实现细节聚集地。 -> Mitigation: 新增 `src/knowledge/`，runtime 只依赖 port/service。
- [Risk] 用户问实现细节时知识库误答。 -> Mitigation: Evidence Judge 规则要求日志、接口、类名、文件路径、表名、配置项等信号必须升级代码。
- [Risk] visibility 控制不足导致敏感信息进入用户回复。 -> Mitigation: MVP 对 `restricted` 文档仅允许摘要进入用户回复，原文留在受控 evidence/log。
- [Risk] 搜索质量不足。 -> Mitigation: 先用 taxonomy、alias、metadata filter 和可观测日志，让失败可解释，再逐步引入 BM25/向量/reranker。

## Migration Plan

Phase 1: OpenSpec 和 workspace schema

- 完成 proposal/design/spec/tasks。
- 更新开发文档，登记 `src/knowledge/` 模块边界。
- 明确 workspace `knowledge/` 和 `repos/` 结构。

Phase 2: taxonomy 和 Markdown 模板

- 新增 taxonomy 文件示例。
- 新增知识文档模板。
- 新增 `_sources` source metadata、whitepaper parent slice 和 evidence chunk 的 schema 示例。
- 新增 frontmatter 校验规则和 lint 测试。

Phase 3: 基础知识库搜索 MVP

- 实现 Markdown 文件发现和 frontmatter 解析。
- 实现 source document 元数据读取、parent slice 解析、可重建 chunk index 读取。
- 实现 module routing、chunk/parent 关键词搜索、metadata 过滤和 evidence pack。
- 命中 chunk 后加载 parent slice，用 parent slice 支撑回答，用 source document/page 支撑溯源。
- 不引入外部检索依赖。

Phase 4: Agent 工作流接入

- 增加 Knowledge Router 和 Evidence Judge Agent 配置。
- runtime 在 Experience 后、Claude Code 前执行知识检索和 judge。
- 知识证据足够时直接进入 Review/Presentation。
- 知识证据不足时构造 `DiagnosticRequest` 升级到现有 worker。

Phase 5: Case Curator

- 识别用户确认已解决。
- 生成 solved case Markdown 草稿。
- 保存到 `knowledge/tickets/solved-cases/`。
- 标记 `review_required`、`confidence: medium` 和 index dirty。

Phase 6: 评测和可观测性

- 增加知识命中、代码升级、冲突、过期、case 沉淀的测试。
- 扩展 `/api/logs` 展示。
- 增加评测 fixtures：FAQ 命中、runbook 命中、过期文档、冲突文档、实现细节升级、solved case 沉淀。

Phase 7: 高级检索

- 引入 BM25 或轻量倒排索引。
- 引入向量检索、hybrid search、reranker。
- 引入 parent-child retrieval 支持长文档。
- 探索 GraphRAG / 知识图谱。

Rollback strategy:

- Phase 1/2 是文档和模板，可直接回退文件。
- Phase 3 的知识搜索服务应可配置关闭，关闭后恢复现有 Experience -> Preflight -> Worker 行为。
- Phase 4 接入必须保留 feature flag 或配置开关，失败时降级到现有 Claude Code 流程。
- Phase 5 沉淀流程失败不得影响用户最终回复，只记录日志和错误。

## Open Questions

- `knowledge/` 是否总是位于 workspace root，还是允许配置 `knowledgeRootPath`？
- `repos/` 是否属于同一个 workspace root，还是每个 repo 保留独立 `WorkspaceConfig`？
- solved case 的 owner 默认来自 workspace 配置、module taxonomy，还是当前用户？
- 受限 visibility 的文档在本地 MVP 中是否需要用户角色权限模型，还是先只做脱敏展示约束？
- 是否需要新增显式 `/api/cases/:id/resolve`，还是先通过用户自然语言“已解决”触发 Case Curator？
- YAML frontmatter 是否允许数组对象，还是 MVP 限制为简单标量/数组以降低 parser 复杂度？
- PDF 导入第一阶段是否只支持人工/半自动转换后的 Markdown，还是需要内置 PDF text extraction？
- evidence chunk 是否只存 `indexes/chunks.jsonl`，还是也允许每个 parent slice 旁边保存局部 chunk 文件？
