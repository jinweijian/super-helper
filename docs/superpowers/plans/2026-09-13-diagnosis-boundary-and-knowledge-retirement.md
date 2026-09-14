# 诊断权威边界与旧知识库下线方案

## 目标

将 `super helper` 收敛为“整理输入、管理过程、整理输出”的支持程序。当前项目排查由可替换的权威诊断适配器完成，第一期适配器为 Claude Code（CC）；未来可以替换为 DeepSeek Harness 或其他实现。旧文档知识库不再参与在线诊断，也不再作为产品主路径。

用户可见结果：用户提交问题后，系统先准备项目、会话、工单经验和受限工具上下文，再由权威诊断方完成排查；页面展示权威方的结论、依据、推断和待验证项，只进行必要的脱敏、结构化和排版。

## 不在本阶段范围

- 不实现 Cognee/知识图谱的实体抽取、图谱构建或在线查询。
- 不删除工单 CSV 导入、经验 Markdown、经验审核和版本追踪。
- 不把 CC 的技术结论重新交给业务规则做二次裁决。
- 不改变现有 Case、Run、Evidence 和日志的持久化兼容格式，除非另有迁移设计。

## 目标职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| Gateway/UI | 接收输入、选择模式、展示状态和结果 | 技术判断、证据裁决、调用厂商协议 |
| Session | Case、回合上下文、消息与日志持久化 | 模型调用、排查结论 |
| Input preparation | 生成结构化问题、项目范围、经验和工具上下文 | 过早追问、判断根因 |
| Experience | 提供经审核的历史工单经验和来源信息 | 直接生成最终结论 |
| MCP/Redmine | 提供受限只读外部数据 | 解释数据、回复用户 |
| Authority adapter | 调用 CC 或未来替代实现，返回统一诊断结果 | 会话编排、页面回复、业务知识库判断 |
| Output sanitizer/presenter | 脱敏、保留事实/推断边界、排版 | 改写或否定权威技术判断 |
| Graph provider | 未来接入 Cognee 等图谱实现 | 当前在线诊断、替代权威方 |

## 核心适配器合同

新增 `AuthorityDiagnosticAdapter` 端口，放在 `src/contracts/` 或 `src/workers/` 的稳定合同层。输入是已整理的 `DiagnosticRequest` 和只读能力；输出是统一的 `DiagnosticResult` 与受限执行元数据。

```text
DiagnosticRequest
  -> AuthorityDiagnosticAdapter.diagnose()
  -> AuthorityDiagnosticResult
  -> output sanitizer
  -> presentation
```

CC 是第一个 adapter：它保留现有只读工具、会话复用、取消、超时和错误归一化。未来 DeepSeek Harness 只实现同一端口，不进入 Runtime 主流程，也不需要改变 UI 或 Case 合同。

权威结果中的 `fact`、`inference`、`assumption`、`unknown` 和 `next_action` 必须保留类型；程序只检查结构完整性、来源存在性、敏感信息和操作权限，不根据关键词或自身业务规则重新推断技术原因。

## 旧知识库下线范围

### 在线路径立即移除

- `KnowledgeTurnService` 不再由普通诊断 Runtime 调用。
- `Knowledge Router`、RAG Answerability、知识 Evidence Judge 不再阻断或改写权威诊断结果。
- BM25、Embedding、Rerank 不再参与在线诊断候选排序。
- 历史案例并行收集不再把旧文档知识库作为来源。

### 产品入口下线

- 设置页移除知识库目录、知识源目录、重建索引和 RAG 可回答性开关。
- Dashboard 移除知识库健康、绑定、重建索引等普通用户入口。
- `/api/knowledge/*` 标记为迁移期兼容接口，前端不再调用；后续版本删除。

### 暂时保留

- 工单经验相关代码，迁移到明确的 `experience` 归属下。
- Cognee provider contract 和受治理的图谱读写适配器。
- 旧知识库离线导出、审计和迁移工具，直到经验/图谱迁移完成。

## 在线新流程

```text
输入
  -> 建立 Case 与 AnswerGoal
  -> 最小前置检查
  -> 收集经验、Redmine/MCP 和项目范围
  -> Authority adapter 执行第一轮排查
  -> 结构与安全检查
  -> 展示权威结果
  -> 仅在结果明确缺少必要信息时生成具体追问
```

只要问题和项目范围足够开始检查，就不得在第一轮前追问。追问必须来自权威结果的 `unknown` 或明确的缺失证据，并说明用户可以在哪里获得该信息。

## 分阶段实施

### 阶段一：冻结职责与合同

相关文件：`src/contracts/`、`src/workers/`、`docs/architecture/`、`src/agents/`。

- 定义 authority adapter 输入输出合同。
- 明确 CC adapter 与 Runtime 的边界。
- 更新 Agent 注册表，删除知识库在线阶段的必经关系。
- 增加一条真实 CC 结果的结构化 fixture，覆盖“已确认结论 + 推断 + 待验证项”。

完成标准：同一份 authority result 可以被 CC 和 fake adapter 分别返回，UI/API 不感知具体实现。

### 阶段二：切断旧知识库在线路径

相关文件：`src/runtime/diagnostic-runtime.ts`、`src/runtime/runtime-composition.ts`、历史案例收集器、设置与 Dashboard。

- 删除 Runtime 对 Knowledge/RAG 的在线调用。
- 保留经验、MCP/Redmine 和当前项目只读排查。
- 记录一次明确的配置/日志状态，表明旧知识库未参与本轮。
- 删除或隐藏知识库设置项和 Dashboard 操作入口。

完成标准：一轮诊断日志中不存在 Knowledge Router、RAG Answerability 或知识库检索阶段；CC 仍可完成当前项目排查。

### 阶段三：收敛输出层

相关文件：`src/runtime/review-presentation.ts`、`src/runtime/safe-answer-renderer.ts`、`web/src/dashboard/ChatPanel.vue`。

- 将审核层限定为结构、安全和来源检查。
- 保留权威方的结论顺序和语义，不再用“证据不足”模板覆盖有效结果。
- 展示“结论 / 判断依据 / 推断 / 还需验证”四类信息。
- 权威方失败时才使用降级回复。

完成标准：CC 已返回有效结论时，页面必须展示该结论；CC 未形成结论时，页面才显示证据不足并生成具体追问。

### 阶段四：经验与图谱接入准备

相关文件：`src/application/experience-refinement/`、`src/contracts/experience-index.ts`、`src/providers/experience-index/`。

- 将工单经验产物作为图谱输入，而不是旧知识库切片。
- 保留 CSV 来源、工单 ID、修订号、内容哈希和审核状态。
- 为 Cognee 建立独立 provider contract，图谱查询只能提供参考上下文。
- 图谱结果进入 Input preparation，不直接成为最终回答。

完成标准：图谱 provider 可替换、可关闭、可审计；其不可用不影响 CC 当前项目排查。

## 验收门禁

- 本地：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test` 全部通过。
- 行为：CC 有效结论不会被降级；CC 失败会安全降级；首轮不会因普通缺失信息过早追问。
- 链路：在线诊断不触发旧知识库检索、Embedding 或 Rerank。
- 兼容：现有经验 CSV、经验 Markdown、Case JSON 和日志读取不受破坏。
- 真实环境：使用一个真实项目问题验证 CC 结论能完整出现在页面；再用一个证据不足问题验证追问只在第一轮排查之后出现。

## 回滚边界

旧知识库代码和离线资产在迁移期保留；在线开关可回退到兼容模式，但不应重新默认启用。Authority adapter 的替换不改变 Case、UI 或经验产物合同。
