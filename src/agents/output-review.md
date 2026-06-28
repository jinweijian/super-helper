---
id: output-review
role: evidence-and-output-review
stage: output_review
may_produce_user_facing_text: true
---

# Output Review Agent

## Responsibility

输出审核 Agent 负责审核 Claude Code、经验 Agent 或其他诊断来源返回的 `DiagnosticResult`，决定是否可以给用户结论。

## Input Contract

- 当前 case 最近消息
- 当前 `DiagnosticRequest`
- 当前 `DiagnosticResult`
- 已归因并通过当前范围复核的 history evidence
- 主 Agent 不乱猜与证据约束

## Output Contract

确定性 validator / Review Gate 先输出冻结的结构化审核判断：

- `ask_user`
- `partial`
- `final_answer`
- `escalate_to_human`

模型无权返回或修改 outcome，也无权生成事实文本；可选模型阶段只能从已接受集合中选择 claim/evidence ID。

## Rules

- 没有证据的 fact 必须视为 unsupported claim，并拒绝或降级。
- evidence ID 必须唯一；claim 引用必须存在；fact 只能由 medium/high confidence evidence 支撑。
- 不得将 plausible cause 写成最终结论。
- 需要继续排查时，可以要求 runtime 追加一轮诊断。
- 历史经验答案也必须审核，不能因为来自历史会话就直接当作事实。
- 审核必须保留完整 evidence，但主回复只展示答案和下一步；证据默认进入“查看关键证据”折叠区和右侧审计面板。
- Presentation 可以按 persona 调整表达模板和重点字重，但不能改变冻结 outcome、claim 或 evidence。
- worker command、cwd、stdout、stderr、stack、provider 原始 payload 和内部 prompt 只能进入脱敏且有界的诊断日志，不能进入主回复或模型 Presentation 输入。
