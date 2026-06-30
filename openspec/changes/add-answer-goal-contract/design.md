## Context

当前数据流为：

```text
ResolvedTurnContext.resolvedQuery
  -> DiagnosticRequest.userGoal
  -> worker / knowledge / experience
  -> DiagnosticResult.claims[]
  -> deterministic evidence validation
  -> Presentation 选择 directAnswerClaimIds
```

这个链路只传递自然语言字符串，没有表达：

- 用户原始问题是什么。
- 当前轮必须回答哪些项。
- 哪些 claim 是主答，哪些只是定位、背景、流程说明。
- 内部诊断目标和用户可见回答目标的边界。

## Design

### AnswerGoal

`AnswerGoal` 是本轮回答目标的唯一权威结构：

```ts
interface AnswerGoal {
  rawUserQuestion: string;
  resolvedQuestion: string;
  answerObject: string;
  mustAnswerItems: string[];
  diagnosticObjective: string;
  sourceMessageIds: string[];
}
```

- `rawUserQuestion`：最新用户消息。
- `resolvedQuestion`：结合同案上下文后的用户问题，仍保持用户可见语义。
- `answerObject`：本轮回答对象，用于 presentation 标题和审核日志。
- `mustAnswerItems`：主答必须覆盖的项目，不枚举问法类型。
- `diagnosticObjective`：内部排查目标，可包含“继续追查上一轮缺失证据”，但不能进入用户结论。
- `sourceMessageIds`：目标来源消息。

### Claim Role

`DiagnosticClaim` 必须带：

```ts
role: 'primary_answer' | 'supporting_context' | 'evidence_locator' | 'process_note' | 'next_action' | 'unknown';
answers: string[];
```

只有 `primary_answer` 能成为主结论。`supporting_context`、`evidence_locator`、`process_note` 永远不能做结论第一句。

### Review Validation

`validateAnswerGoalCoverage` 在 deterministic review 中运行：

- `final_answer` 没有 accepted `primary_answer` 时降级为 `partial`。
- `primary_answer.answers` 未覆盖 `AnswerGoal.mustAnswerItems` 时降级为 `partial`。
- missingInfo 只有被转换成 `primary_answer` 或 `next_action` 并覆盖 mustAnswerItems 时才能作为本轮直接回答。

### Presentation

Presentation 输入包含 `answerGoal` 和 frozen `primaryAnswerClaimIds`。模型不能自行选择 direct answer claim；若模型输出不包含 frozen primary claim，runtime fallback。

Presentation runtime validation 只接受结构化 contract：

- `directAnswerClaimIds` 必须与 frozen primary answer claim IDs 形成相同的唯一集合；重复 ID 不能抵消缺失的 primary claim。
- `evidenceIds` 必须由 selected accepted claims 直接引用；result 中存在但未被 selected claim 使用的 evidence 不能授权 reply 增加事实。
- 校验范围覆盖完整用户可见 `reply`，不能只校验第一段。
- 主答选择不得依赖中文问法枚举或泛化动作词黑名单；判断依据只来自 `AnswerGoal.mustAnswerItems`、frozen primary answer claim IDs 和 accepted claims/evidence/missingInfo。

## Non-Goals

- 不保留旧 case JSON 迁移。
- 不新增复杂意图分类器。
- 不扩展 retrieval 排序或 UI 功能。
