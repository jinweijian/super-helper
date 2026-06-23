# Implementation Notes

## Baseline And RED Evidence

- Resolved turn：`test/conversation-evidence-lifecycle.test.mjs` 首轮 5/5 RED；旧实现把“不清楚”和“是不是数据库字段问题”放入下游有效文本/known facts，且 Knowledge 与 Worker 缺少统一 resolved query 合同。新增 source-bound、长会话、有界上下文与具体补充信息用例后转为 GREEN。
- Experience：RED 证明 Experience 位于 Preflight 前、会取 case 最新但不相关 run，且未校验 tenant/user/freshness/quality。GREEN 后先完成安全/权限预检，再按 user message -> replyTo helper -> source run 绑定，并把未通过复核的候选以 ID/拒绝原因写入当前 request context。
- Review/presentation：RED 证明不存在 evidence ID 的事实可穿过浅审核，旧模型可直接返回 outcome/reply。GREEN 后 `result-validator` 确定性校验证据唯一性、引用、claim type、unknown/低置信度事实并冻结 outcome；模型只允许选择已接受 claim/evidence ID。
- Worker failure：RED 证明 worker 失败摘要、exitCode 和原始 provider 错误可进入主回复。GREEN 后主回复只显示安全类别、状态、下一步与 case/run，stdout/stderr/command/cwd 只进入有界脱敏日志。

## GREEN And Runtime Path Evidence

- Sync turn：真实 `SuperHelperAgent.handleUserMessage` 首轮走 Preflight -> Experience -> Knowledge -> Worker -> deterministic review，未绕开生产 runtime composition。
- Async turn：同一 case 使用 `startUserTurn` + `completeUserTurn` 处理“不清楚”，与同步路径共用 `DiagnosticRuntime.completeUserTurnNow` 和同一串行队列。
- Follow-up/unknown：运行时测试断言 Experience event、Knowledge Router event、`DiagnosticRequest.userGoal` 与 Worker request 全部收到原始未解决问题；`latestUserMessage` 和 case message 仍保留“不清楚”。具体 500 补充会合并进 unresolved query 并以 source message ID 标为用户可观察事实。
- Historical reuse：多 run 用例只复用目标问题对应的 `run_first`，不附加 `run_latest`；stale/invisible history 被记录为 rejected candidate 并继续正常诊断；当前且可见证据可复用且不调用 worker。

## Compatibility And Isolation

- Old case JSON：新增 `resolvedTurn`、`experienceCandidates`、Evidence validation、claim ID 均为 optional；已有无这些字段的 case 继续由 store/session API 读取，未迁移持久化 JSON shape。
- HTTP/agents DTO：`/api/agents` 仅新增 optional `executionMode`，保留原字段；Session API 的 run/workerTrace shape 不变，但对新旧 trace 都执行有界脱敏；公共 chat/session/log/settings 回归通过。
- Tenant/user/workspace isolation：Experience 在搜索前同时过滤 tenant、user、workspace；跨 tenant/user 相同问题测试返回 miss。Resolved context 只读取当前 case 的最多 12 条用户消息与现有 bounded session context。

## Privacy And Boundary Audit

- Raw worker output：非零退出且没有可用领域证据时，Presentation 模型不会获得 raw trace；主回复不含 command/cwd/stdout/stderr/error/exitCode。新 trace 写入 run 前即脱敏有界，旧 trace 通过 Session/Logs DTO 时再次脱敏。
- Prompt/secret redaction：worker trace 覆盖 bearer、authorization、api-key、token、cookie、password 和 CLI secret flags；测试证明任意上下文 secret 不进入主回复或公开日志，command/stdout 长度分别受 2000/8000 字符边界约束。默认 provider 关闭；模型权威测试使用 fake fetch，没有真实网络/付费调用。
- Module boundaries：gateway 仅对 Session/Logs DTO 做安全序列化；runtime 拥有 resolved turn、Experience、Review/Presentation 决策；observability 拥有 worker trace 安全转换；worker adapter 和持久化 shape 未混入 HTTP 决策。module-boundary 全量测试通过。

## Anti-Fake-Complete Findings

- Production path proof：同步/异步真实 Agent 回合、Experience hit/miss、安全 Preflight、Knowledge direct/escalation、worker failure、模型 malformed/越权结果、API legacy trace 均走生产类与文件 store，不以纯 mock helper 断言替代 runtime path。
- Artifact/spec updates：审计中发现并修复四个初稿缺口：Preflight 没有 write-risk veto；model reconcile 在字段缺省时会错误降级全部事实；Presentation 仍使用未校验 worker summary；旧 Session/Logs API 可呈现未脱敏 trace。对应 spec/tasks 不降级，代码和回归测试已补齐。

## Final Verification

- `openspec validate`：`openspec validate harden-conversation-evidence-lifecycle --strict` 通过；另外两份关联 change 也通过 strict validate。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm test`：247 项通过，0 失败。

## Deviations And Remaining Risks

- Experience 对 legacy 历史证据采用 fail-closed：缺少 active/visibility/freshness/quality validation metadata 的旧回复只作为 rejected candidate，不自动直答；需要重新验证后才可复用。
- 新 worker trace 在写入 case 前会脱敏；为避免静默改写历史 JSON，已经落盘的旧 trace 不做文件级迁移，但所有 Session/Logs 公共读取路径会再次脱敏。
- Resolved turn 的本地分类使用可审计规则和 source IDs，中文表达模式仍可能需要随真实会话样本扩充；模型只能降级，不能提升事实权威。
