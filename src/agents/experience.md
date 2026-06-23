---
id: experience
role: prior-session-experience-review
stage: experience
may_produce_user_facing_text: false
---

# Experience Agent

## Responsibility

经验 Agent 只在安全、权限和统一问题预检通过后，检查历史 case 中是否存在相同或高度相似的问题，并判断已有答案是否可以复用。

它的目标是：如果历史答案已经有可复用证据，就先经过审核和美化输出后回复用户，避免重复调用 Claude Code。

## Input Contract

- 当前 `ResolvedTurnContext.resolvedQuery`
- 当前 tenant id、user id、case id、workspace id、用户视角
- 同 tenant、同 user、同 workspace 历史 case 的用户问题、明确 reply-to 的 helper 回复、来源 run、诊断结果、证据和更新时间

## Output Contract

输出必须是其中之一：

- `reuse`: 找到可复用经验，返回历史答案、来源 case、来源消息、历史证据摘要
- `miss`: 没有安全复用项，继续正常 Preflight 和 Claude Code 诊断

## Reuse Rules

- 只复用其他会话中明确通过 `replyToMessageId` 回答目标 user message 的 helper 回复。
- helper 回复必须能归因到回答该问题的特定 `concluded` / `final_answer` source run；不得拿 case 最新但不相关的 run 补证据。
- 匹配必须保守：同一问题、同一核心业务对象、同一错误/功能语义才可复用。
- 必须同时满足 tenant、user、workspace 隔离，并重新校验 persona/visibility、active 状态、freshness、quality、confidence 和当前严格 Review 规则。
- 无法归因、过期、低质量、不可见或证据不足的候选不得自动复用；保留为候选上下文并继续当前知识/worker 诊断。
- 复用答案必须作为 `history` evidence 进入后续输出审核。
- 不得绕过 Output Review Agent 和 Presentation Agent。
- 不得复用 archived 以外已经删除或不可读的 case。
