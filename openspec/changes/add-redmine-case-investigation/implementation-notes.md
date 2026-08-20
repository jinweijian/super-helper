# add-redmine-case-investigation Implementation Notes

## Baseline

- Change schema/status: `not_run`
- Master baseline commit: `801281b`
- External EduSoho workspace baseline: `develop @ 483eecf201f`
- External Redmine worktree baseline: `cf596d8`, local modifications limited to `src/config/io.ts` and `test/historical-case-config.test.mjs`

## Red/Green Evidence

| Task | Red command/result | Green command/result | Commit |
| --- | --- | --- | --- |
| Configuration contracts | build 成功；专项 `24 pass / 9 fail`，9 个失败均为缺少校验或 onboarding 未保留字段 | build 成功；专项 `33/33 pass`；`pnpm typecheck` exit 0 | `6417cf7` |
| Redmine API/search | build 成功；专项因 `search.js` 不存在退出 1 | API + probe 专项 `16/16 pass`，所有捕获请求为 GET | `83ed4b0` |
| Privacy/bounding | build 成功；专项因 `bounding.js`/`normalizer.js` 不存在退出 1 | Redmine API/probe/privacy 专项 `18/18 pass`；敏感诱饵与私有备注均不可见 | `460e328` |
| MCP server/stdio | build 成功；专项因 `candidate-grants.js`/server 不存在退出 1，stdio 子进程关闭 | Redmine 全链专项 `22/22 pass`；真实 SDK stdio list/search/detail 同会话通过 | `0c4c2d1` |
| Historical evidence service | build 成功；专项因 service 模块不存在退出 1 | historical + legacy MCP + stdio 专项 `25/25 pass`；同一 MCP 会话保持 grant，48K JSON 合法 | `2a91dee` |
| Model services | build 成功；专项因四个 model service 模块不存在退出 1 | model service `5/5 pass`；agent/knowledge/MCP 回归 `51/51 pass` | `2ef59b0` |
| Collectors/runtime/gate | collectors 专项 `0/2`，缺少 `collect`/`collectEvidence` 方法；runtime/gate 专项因模块缺失退出 1 | collector/runtime/gate `15/15 pass`；生产 `DiagnosticRuntime` 证明配置来源后恰好一次搜索、一次 fallback Worker、一个 Run 和一个 helper reply | `73a7d3c` + 当前提交 |
| Observability/UI | observability 专项先因 recorder 方法缺失 `0/1` | runtime/observability/owner 专项 `20/20 pass`；Web `13 files / 54 tests pass`；四阶段 Dashboard 映射和文档更新完成 | 当前提交 |
| Offline/real acceptance harness | offline 第二场景先被固定 fixture 错误提升为 `concluded`；持久化审计随后证明 Redmine 正文进入 Case 并失败 | offline 三场景 `1/1 pass`；Redmine evidence 持久化改为通用占位；real manifest/evaluator/fail-closed runner 与边界专项合计 `43/43 pass` | 当前提交 |
| 真实模型契约稳定性 | 真实详情使 DeepSeek V4 默认思考耗尽 1200 completion tokens，`finish_reason=length` 且 `content` 为空；Analyzer 又混用了 block ID 与顶层 Evidence ID | DeepSeek JSON 契约默认关闭思考；Analyzer 输入移除 block ID 并显式列出 allowed Evidence ID；编号/复合数字标识由 Runtime 保真并过滤无关候选；相关专项通过 | 当前提交 |
| 真实验收 fail-fast | 模型余额耗尽后，原 runner 会进入三场运行并在约 18 分钟后才汇总降级结果 | runner 在启动 HTTP Runtime 前用生产 model adapter 做最小 JSON 健康检查；当前 402 在 3 秒内以 `real_model_health=FAIL` 安全退出 | 当前提交 |

## Offline Verification

| Command | Exit | Result |
| --- | ---: | --- |
| `openspec status --change add-redmine-case-investigation --json` | 0 | change planning artifacts `proposal/design/specs/tasks` 全部 `done` |
| `pnpm lint` | 0 | 文档与术语检查通过 |
| `pnpm typecheck` | 0 | TypeScript 与 Vue typecheck 通过 |
| `pnpm build` | 0 | Vite + TypeScript production build 通过 |
| focused Redmine/case tests | 0 | model/adapter/runtime/gate/acceptance/边界专项通过 |
| `pnpm test` | 0 | `569/569 pass` |
| `pnpm test:web` | 0 | `13 files / 54 tests pass` |
| `pnpm acceptance:redmine:offline` | 0 | 正式 Runtime + 真实 MCP SDK stdio，三类结构结果通过且无网络/真实 key |

## Real E2E Verification

真实工单正文、人员身份、查询文本、凭证和 Worker 原始输出不得写入本文件。

| Scenario | Expected | Actual | Redmine status | Evidence kinds | Review decision | Read-only audit |
| --- | --- | --- | --- | --- | --- | --- |
| `resolved_by_ticket` | current + Redmine evidence support a resolved conclusion | PASS：`concluded/final_answer`；10 candidates / 3 details / 3 leads；1 same-root + 2 diagnostic leads；Worker 与 3 项验证完成 | `completed` | `mcp, workspace` | `coverage_complete` | PASS |
| `not_resolved_by_ticket` | historical evidence does not become a current solution | PASS：`partial/continue_diagnosis`；候选因不匹配标识在详情前过滤；无历史主结论；fallback Worker 完成 | `no_hit` | `knowledge, workspace` | `coverage_incomplete` | PASS |
| `direction_helpful` | preliminary direction without confirmed current root cause | PASS：`partial/continue_diagnosis`；10 candidates / 1 detail / 2 diagnostic leads；Worker 与 2 项验证完成；无 same-root 结论 | `completed` | `mcp, workspace` | `upstream_partial` | PASS |

2026-08-20 在同一代码状态、同一命令中取得三场 PASS，全部 10 项真实前置条件（含生产模型健康检查）通过。三场 runtime artifact privacy 均 PASS；Redmine HTTP 全部 GET；MCP surface 恰好只有 search/detail 两个读工具；三个 Case 与验收服务清理均 PASS。报告只输出安全枚举与计数，不含真实 prompt、工单正文、身份、URL、凭证或 Worker 原始输出。

## Anti-Fake-Complete Audit

- Production composition trace: `DiagnosticRuntime` → `createRuntimeServices` → `RedmineBranch` / `HistoricalCaseEvidenceService` → MCP stdio → Analyzer → 单 Worker → Verifier → Gate → Review → Presentation；真实 runner 通过正式 `startServer` 入口执行。
- Fake fallback scan: real runner 源码无 fake client/evidence/model/worker 注入；缺真实前置条件直接非零退出。
- Module boundary scan: `test/module-boundaries.test.mjs` 与全量 owner/budget tests 通过；`review-presentation.ts` 保持 300 行预算。
- Default no-network scan: 默认 `pnpm test` 和 offline acceptance 不读取真实 key、不访问真实 Redmine/模型。
- Privacy/secret/raw-content scan: 已执行真实场景的 runtime artifact privacy 全部 PASS；报告只含状态、计数、枚举和 Evidence kind。
- Old config/Case/cache compatibility: 旧配置与旧 Case 兼容测试包含在 `569/569` 全量通过中；未修改持久化 JSON shape。
- External workspace preservation: `/Users/king/website/edusoho` 保持 clean；外部 Redmine worktree 仍只有基线两处已有修改。
- Completion audit: 已逐条对照 proposal、design、8 份 delta spec 和 46 项 tasks；配置、固定范围 GET-only MCP、隐私过滤、并行采证、单 Worker、双侧证据门禁、一次呈现、可观测性、离线/真实三类验收及 master 收尾均有直接证据，没有用局部 probe 替代完整目标。

## Deviations and Remaining Risks

- Current deviation: 无。此前的 DeepSeek HTTP 402 已在额度恢复后通过生产模型健康检查，并完成同轮三场真实 E2E。
- Remaining risk: 真实 Redmine 数据与外部模型服务会随时间变化；后续发布前应继续使用显式 opt-in 命令重跑，禁止把当前期望自动改写为模型实际输出。
