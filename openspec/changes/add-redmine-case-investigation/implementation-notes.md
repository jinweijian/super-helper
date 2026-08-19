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

## Offline Verification

| Command | Exit | Result |
| --- | ---: | --- |
| `openspec status --change add-redmine-case-investigation --json` | `not_run` | `not_run` |
| `pnpm lint` | `not_run` | `not_run` |
| `pnpm typecheck` | `not_run` | `not_run` |
| `pnpm build` | `not_run` | `not_run` |
| focused Redmine/case tests | `not_run` | `not_run` |
| `pnpm test` | `not_run` | `not_run` |
| `pnpm test:web` | `not_run` | `not_run` |
| `pnpm acceptance:redmine:offline` | 0 | 正式 Runtime + 真实 MCP SDK stdio，三类结构结果通过且无网络/真实 key |

## Real E2E Verification

真实工单正文、人员身份、查询文本、凭证和 Worker 原始输出不得写入本文件。

| Scenario | Expected | Actual | Redmine status | Evidence kinds | Review decision | Read-only audit |
| --- | --- | --- | --- | --- | --- | --- |
| `resolved_by_ticket` | current + Redmine evidence support a resolved conclusion | `not_run` | `not_run` | `not_run` | `not_run` | `not_run` |
| `not_resolved_by_ticket` | historical evidence does not become a current solution | `not_run` | `not_run` | `not_run` | `not_run` | `not_run` |
| `direction_helpful` | preliminary direction without confirmed current root cause | `not_run` | `not_run` | `not_run` | `not_run` | `not_run` |

## Anti-Fake-Complete Audit

- Production composition trace: `not_run`
- Fake fallback scan: `not_run`
- Module boundary scan: `not_run`
- Default no-network scan: `not_run`
- Privacy/secret/raw-content scan: `not_run`
- Old config/Case/cache compatibility: `not_run`
- External workspace preservation: `not_run`

## Deviations and Remaining Risks

- Current deviation: 无；生产接线、离线验收和真实验收 harness 已按设计实现。
- Remaining risk: 真实三场景尚未运行；全量 Node/Web 测试、最终隐私审计和外部 workspace 保全复核仍待完成。
