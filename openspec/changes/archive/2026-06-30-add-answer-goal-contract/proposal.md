## Why

当前 runtime 只把用户目标保存为 `userGoal` 字符串，Evidence Review 只校验证据是否可信，却没有冻结“本轮到底要回答什么”。多 Agent 协作后，路由、知识命中摘要、内部诊断目标或 Presentation 模板话术都可能被当成结论。

这已经造成两类用户可见问题：

- 用户问“APP 发现页空白是什么问题”，结论却先回答页面路由。
- 用户追问“下一步做什么、给什么信息”，结论却回答“本轮目标是提供清单”。

这些不是单点 prompt 问题，而是目标契约缺失。继续用短语硬编码修补会让系统换一种问法就再次跑偏。

## What Changes

- 用 `AnswerGoal` 取代 `DiagnosticRequest.userGoal` 作为 runtime、worker、knowledge、review、presentation 的权威目标契约。
- `DiagnosticClaim` 必须声明 `role` 和 `answers`，Review Gate 只允许 `primary_answer` 作为结论第一句来源。
- 新增 deterministic answer-goal validation：`final_answer` 必须有 accepted primary answer，并覆盖 `AnswerGoal.mustAnswerItems`。
- knowledge direct answer 不再把“知识库命中...”作为主 claim；该文本只能做 summary/supporting context。
- Presentation 不再选择 direct answer claim，只表达 runtime 冻结后的 primary answer。

## Impact

- **Breaking**：旧 `userGoal` 不再作为权威 runtime 字段；旧 worker 输出的无 role claim 会被拒绝或降级。
- **Runtime**：request builder、preflight、knowledge turn、worker turn、review/presentation、event recorder 需要统一迁移到 `answerGoal`。
- **Worker**：Claude prompt 和 output parser 需要要求 claim role/answers。
- **Docs**：同步 Agent 设计、技术架构和产品 Agent 配置。
