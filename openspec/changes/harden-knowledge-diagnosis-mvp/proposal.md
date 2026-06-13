## Why

`add-layered-knowledge-workspace` 已经把企业知识库 MVP 跑通，但当前系统仍处在“可用原型”阶段：白皮书切割质量、Evidence Judge 语义可靠性、Deep Query 多轮纠偏、真实服务验收、Case Curator 审核闭环还不足以支撑长期企业级使用。

本 change 先把这些高优先级补强项拆成可审核的 OpenSpec 计划，待用户审核后再执行实现；检索体系升级（BM25/vector/hybrid/reranker/GraphRAG）作为独立研究方向，不在本 change 中实现。

## What Changes

- 增加知识入库切割质量控制：
  - 审计空切片、目录切片、重复切片、过短切片、过长切片、缺 provenance 切片。
  - 输出机器可读 `chunk-quality-report.json` 和人工可读摘要。
  - 允许 `knowledge:init` / `knowledge:update` 在质量不达标时给出警告而不是静默成功。
- 增强 Evidence Judge：
  - 从当前规则版升级为更结构化的证据覆盖、来源权威、冲突、时效、版本、风险、语义充分性判断。
  - 防止泛词误召回导致知识库误答。
  - 明确 “事实 / 推断 / 假设 / 未知” 在 judge 与最终结果中的传递边界。
- 增强 Deep Query Planner / Query Correction：
  - 支持一轮代码调查失败后的确定性 retry / pivot。
  - 记录已尝试查询、失败原因、下一轮 artifact family、停止条件。
  - 保持 Claude Code 只读 Read/Glob/Grep 约束。
- 增加真实服务验收：
  - 提供本机配置、远程模型、Claude Code、知识直答、无命中升级、实现细节升级的 smoke/acceptance 验证命令。
  - 验收必须避免泄露 secret，并能输出可审计报告。
- 建立 Case Curator review 工作流：
  - 草稿生成后支持审核、批准、拒绝、转 unresolved case。
  - 审核通过后才允许从 `review_required` 变为 `active`，并触发索引刷新。
  - 增加 reviewer、reviewed_at、review_notes 等元数据或独立 review record。
- 更新架构文档中上一阶段遗留的旧描述，使文档反映 knowledge-first runtime 已接入的事实。

## Capabilities

### New Capabilities

- `knowledge-diagnosis-hardening`: 补强 layered knowledge MVP 的切割质量、Evidence Judge、Deep Query 纠偏、真实验收、Case Review 工作流。

### Modified Capabilities

- None. 当前仓库没有归档到 `openspec/specs/` 的主线 spec；本 change 将新增后续 hardening spec。

## Impact

- 预计影响模块：
  - `src/knowledge/`: 切割质量审计、ingest/update 报告、provenance 与 slice 质量规则。
  - `src/runtime/`: Evidence Judge 编排、Deep Query retry/pivot、Case Review 触发和状态流。
  - `src/agents/`: 如需新增 review agent 或更新 Evidence Judge / Case Curator 配置，必须仍放在本目录并登记 registry。
  - `src/sessions/`: 仅允许通过可选 context 字段携带 deep query attempt 与 review 信息，不破坏 case JSON shape。
  - `src/workers/`: 保持 Claude Code 只读 worker port；不得承载知识检索或最终回复。
  - `src/observability/`: 增加质量审计、deep query retry、case review 的日志展示。
  - `src/gateway/`: 仅在需要 review API / health API 时做 DTO 和路由，不写业务决策。
  - `docs/`: 更新过时架构描述与验收操作文档。
- 不计划引入 BM25、vector DB、hybrid search、reranker 或 GraphRAG；这些属于用户正在研究的检索体系升级方向。
- 不计划改变现有 HTTP response shape 或持久化 case JSON shape，除非后续实现提供可选字段、迁移策略和兼容测试。
