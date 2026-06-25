## Why

当前会话会把所有用户消息直接加入 `knownFacts`，知识检索使用原始最新消息而不是 Preflight 恢复后的真实问题，历史经验还可能把某条旧回复与该 case 的最后一次 run evidence 错配。输出审核主要检查 evidence ID 是否非空，模型可以把 partial 结果提升为 final，破坏“不能乱猜”的最终责任边界。

需要统一每轮 resolved context，绑定历史回复与原 run/evidence，并让确定性 Review Gate 成为模型无法绕过的最终决策者。

## What Changes

- Preflight 生成统一 resolved turn context，区分事实、用户主张、假设、未知和 follow-up。
- Knowledge Router、Retrieval 和 Worker 使用相同 resolved query；“不清楚”保留为 unknown 而不替代原问题。
- Experience 在风险/权限预检之后运行，历史回复必须绑定原始 message、run 和 evidence，并重新验证 workspace、persona、时效和质量。
- 增加确定性 DiagnosticResult/claim/evidence 校验，Review 决定在 Presentation 前冻结。
- Presentation 模型不能再返回或提升 outcome，只能表达已接受 claims；不接受模型新增事实。
- Worker 原始 stdout/stderr 和内部错误只进入诊断日志，主聊天只展示安全摘要。
- 明确 Agent registry 中 deterministic、model-assisted 和 presentation-only 执行模式。

## Capabilities

### New Capabilities

- `resolved-turn-context`: 定义 resolved query、事实、用户主张、假设、未知和 follow-up 合同。
- `validated-experience-reuse`: 定义历史答案与原 run/evidence 绑定、重新验证和安全复用。
- `deterministic-output-review`: 定义 claim/evidence 完整性、固定 review outcome 和受限 Presentation。
- `safe-worker-failure-presentation`: 定义 worker failure 的用户可见摘要与内部原始日志隔离。

### Modified Capabilities

- `knowledge-diagnosis-hardening`: 修改 Evidence claim boundary、上下文、可观测性和兼容要求，使知识与 worker 结果共享同一确定性审核合同。

## Impact

- 主要影响 `src/runtime/`、`src/sessions/context-builder.ts`、`src/domain.ts`、Experience/Review/Presentation tests 和 Agent registry 文档。
- `DiagnosticRequest.context` 只增加可选字段，旧 case JSON 和公共 HTTP response 保持兼容。
- Worker 仍是只读工具，不直接回复用户；gateway、sessions 和 workers 的模块边界不变。
