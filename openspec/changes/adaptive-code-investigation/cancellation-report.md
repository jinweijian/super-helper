# 取消与已审核初步判断修复

## 修复边界

- `ReviewPresentationResult` 与内部 `RuntimeTurnResponse` 添加可选 `hasReviewedAnswer`。它只从最终 `SafeFrozenAnswerProjection.primary/supporting` 中的 fact/inference 片段计算；安全 Worker 失败回复明确为 false。未展示的 process_note、原始 claim/evidence 数量不能决定保留或取消行为。
- Deep 失败后保留 Fast 的已审核 reply 和对应元数据；第二轮取消时使用最终选中的 review，避免错误使用空 Deep result 覆盖已有初步判断。
- Runtime 对所有答案来源统一处理取消：没有审核答案时产生 `user_cancelled` 可重试中断；有审核答案时标记初步、返回 partial，同步已有唯一 helper 正文和 Case partial 状态。
- 元数据不写入 Case JSON，也不增加 Gateway 白名单 DTO 字段。

## 聚焦回归

新增 6 个离线回归，使用真实 `failedExecutionDiagnosticResult`、真实 Review/冻结投影与 fake model：

1. parser 失败中的 fact/process_note 即使带 evidence，取消后仍有 `retryableTurn.reason=user_cancelled`，且只有一条 helper。
2. Fast 产生通过审核的 supporting fact，Deep parser 失败后原始事实仍保留。
3. Deep parser 失败审核期间取消仍保留 Fast 的初步判断。
4. Deep 返回空 result、审核期间取消，previousReview 回退后仍保留 Fast；不会因空 followUpRun.result 丢失已有判断。
5. Knowledge 回合在审核期间取消，原本 final 的审核结果在 Runtime 收尾变 partial；正文注明初步且仍含已审核事实，持久化 Case/helper 同步。
6. Historical 回合同样验证上述收尾语义。两个来源用来源服务替身隔离检索依赖，执行真实 reviewer、completion 和 Runtime 取消收尾。

## 验证

- `pnpm exec tsc -p tsconfig.build.json`：通过。
- `node --test test/investigation-runtime.test.mjs test/turn-presentation-integrity.test.mjs test/investigation-gateway.test.mjs`：33/33 通过。
- 全量 lint/typecheck/build/test 由主任务串行执行；本子任务未运行全量构建或联网模型调用。
