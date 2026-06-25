## Context

当前 runtime 顺序是 Case Curator -> Experience -> Preflight -> Knowledge -> Worker -> Review/Presentation。Experience 在风险预检之前可直接结束回合；历史回复与该 case 最新 result 证据可能错配。Preflight 把所有用户消息加入 `knownFacts`，而 Knowledge 使用 raw latest message，因此“不清楚”虽恢复了旧 `userGoal`，检索的仍是“不清楚”。Model review 同时返回 reply 与 outcome，可将 partial 提升为 final；fallback 还可能把 worker stdout/stderr 放入主聊天。

本 change 在 P0 strict Judge 基础上统一 turn semantics 与最终证据生命周期，不改变 worker、gateway 或 session persistence ownership。

## Goals / Non-Goals

**Goals:**

- 为每轮建立一个 canonical resolved turn context，所有后续阶段使用同一 query 和事实边界。
- 历史经验与原 message/run/evidence 精确绑定，并重新经过当前风险和证据规则。
- 在 Presentation 前完成不可绕过的确定性 Review；模型只能表达被接受内容。
- 将原始 worker failure 限制在诊断日志。
- 保持旧 case JSON 和公共 API 兼容。

**Non-Goals:**

- 不建立跨 tenant/user 的向量化长期记忆。
- 不改变 Claude worker 只读工具权限或让 worker 直接回复用户。
- 不在 sessions 中调用模型或 retrieval。
- 不要求迁移旧 case JSON。

## Decisions

### 1. Resolved turn context 是 runtime 合同

`DiagnosticRequest.context` 增加可选 `resolvedTurn`：`resolvedQuery`、`latestUserMessage`、`confirmedFacts`、`userClaims`、`hypotheses`、`unknowns`、`isFollowUp` 和 source message IDs。Runtime Preflight service 构建它；sessions context builder 只提供 bounded messages/runs，不做语义决策。

本地 fallback 规则：疑问句、包含“可能/会不会/是不是/我猜”的内容进入 claim/hypothesis；用户明确报告的可观察现象可进入 confirmed fact；“不清楚/不知道”进入 unknown。可选 model preflight 只能返回同一结构，local reconciliation 不允许模型把 hypothesis 提升为 fact。

Knowledge Router、Retrieval、Deep Query 和 Worker `userGoal` 全部使用 `resolvedQuery`。Raw message 只用于审计和 UI。

### 2. Experience 是候选证据，不是 Preflight bypass

顺序改为 Preflight risk/permission/turn resolution -> Experience candidate -> Knowledge/Worker。Experience match 必须绑定 source user message 的 `replyToMessageId` 和生成该 reply 的 run；不得使用 case latest result 替代。

复用条件包括同 workspace、兼容 persona/visibility、source run final、evidence 仍存在且未过期、当前 strict Judge 可接受。History evidence 本身不证明业务事实；不满足当前证据条件时继续正常 retrieval/worker。

### 3. Deterministic Review Gate 先于任何 Presentation

新增纯函数 validator：evidence ID 唯一；claim 引用必须存在；fact 至少引用一个 medium/high evidence；unknown 不得伪装 fact；unsupported fact 删除或降级。Review Gate 根据 validated result 固定 `ask_user/partial/final/escalate`，模型不能修改。

Presentation model 不再返回 outcome。它返回受限结构，只能引用 accepted claim IDs 与 evidence IDs；runtime 使用接受的原 claim 文本和安全模板渲染最终回复。解析失败直接使用同一 validated result 的 deterministic formatter。

### 4. Worker failure 主聊天最小化

Raw stdout/stderr、command、cwd、provider payload 和 stack 只进入 RuntimeEventRecorder/日志 DTO。主聊天只显示安全分类、可操作下一步和 case/run 标识，不回显 raw output。既有日志权限与脱敏继续适用。

### 5. Agent registry 公开真实 execution mode

Registry entry 增加可选 `executionMode: deterministic | model_assisted | presentation_only`。Knowledge Router/Evidence Judge 记录为 deterministic（可选 model 辅助不得越过规则）；Presentation 为 presentation_only；Preflight/Output Review 按配置为 model_assisted。公共 agents DTO 只增加兼容可选字段。

## Risks / Trade-offs

- [Risk] 历史经验命中率下降。→ 以错误复用率优先；未通过复核时继续正常诊断。
- [Risk] 本地语句分类不完美。→ 假设宁可降级为 claim/unknown，不得升级为 fact；模型只可进一步降级。
- [Risk] 受限 Presentation 自然度下降。→ 允许重排和非事实连接语，但事实句使用 accepted claim 文本。
- [Risk] 新 context 增加 case 大小。→ 字段可选且 bounded，复用现有截断策略；旧 case 无需迁移。
- [Risk] DTO 新字段影响客户端。→ 仅添加可选字段并保留既有字段与状态值。

## Migration Plan

1. 写 resolved query、“不清楚”、hypothesis、experience mismatch、review promotion 和 raw error RED tests。
2. 增加可选 domain/context 类型与 builder，保持旧 case loader。
3. 调整 runtime 顺序并实现 experience/run 精确关联。
4. 增加 deterministic validator/frozen decision，收窄 Presentation schema。
5. 安全化 worker failure presentation，并保留内部日志。
6. 更新 registry execution mode、Agent docs、architecture docs 和 API compatibility tests。

Rollback：新 context 字段可忽略；deterministic formatter 始终可用。不得回滚到模型可提升 outcome 或主聊天显示 raw worker output。

## Open Questions

无。跨 case 语义记忆和更复杂事实抽取属于后续独立 change。
