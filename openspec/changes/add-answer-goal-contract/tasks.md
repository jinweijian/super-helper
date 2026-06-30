## 1. Contract

- [x] 1.1 在 `src/domain.ts` 新增 `AnswerGoal` 和 `DiagnosticClaimRole`
- [x] 1.2 将 `DiagnosticRequest.userGoal` 替换为 `answerGoal`
- [x] 1.3 将 `DiagnosticClaim` 改为强制 `role` 和 `answers`

## 2. Runtime

- [x] 2.1 新增 `src/runtime/answer-goal.ts` 生成 AnswerGoal
- [x] 2.2 修改 request builder 和 preflight 使用 AnswerGoal
- [x] 2.3 修改 follow-up 构建，不再生成“继续追查上一轮...”用户目标
- [x] 2.4 修改 experience、knowledge、worker、deep query、event recorder 的目标读取

## 3. Review

- [x] 3.1 新增 `src/runtime/answer-goal-validator.ts`
- [x] 3.2 result validator 拒绝无 role claim
- [x] 3.3 final answer 必须有覆盖 mustAnswerItems 的 accepted primary answer

## 4. Presentation

- [x] 4.1 Presentation 输入改为 answerGoal + frozen primary answer IDs
- [x] 4.2 fallback 只使用 frozen primary answer
- [x] 4.3 删除基于用户问法短语的主答选择逻辑

## 5. Tests and Docs

- [x] 5.1 新增 AnswerGoal contract tests
- [x] 5.2 更新 APP 发现页、下一步信息、本地目录行为回归
- [x] 5.3 新增静态防线，禁止 runtime 主答选择 phrase-list gate
- [x] 5.4 同步架构和 Agent 文档
- [x] 5.5 新增 Presentation 边界回归：重复 primary ID、未绑定 evidence、后文新增事实、泛词误杀、过程话术泄漏
- [x] 5.6 运行 `pnpm typecheck && pnpm build && pnpm test && git diff --check`
  - `pnpm typecheck`、`pnpm build`、`pnpm lint`、核心非端口回归、`git diff --check` 已通过。
  - 完整 `pnpm test` 在沙箱内因 `listen EPERM` 失败；沙箱外重跑通过，318 个测试通过。
