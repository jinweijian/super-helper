# add-redmine-case-investigation Implementation Notes

## Baseline

- Change schema/status: `not_run`
- Master baseline commit: `801281b`
- External EduSoho workspace baseline: `develop @ 483eecf201f`
- External Redmine worktree baseline: `cf596d8`, local modifications limited to `src/config/io.ts` and `test/historical-case-config.test.mjs`

## Red/Green Evidence

| Task | Red command/result | Green command/result | Commit |
| --- | --- | --- | --- |
| Configuration contracts | build 成功；专项 `24 pass / 9 fail`，9 个失败均为缺少校验或 onboarding 未保留字段 | build 成功；专项 `33/33 pass`；`pnpm typecheck` exit 0 | `pending` |
| Redmine API/search | build 成功；专项因 `search.js` 不存在退出 1 | API + probe 专项 `16/16 pass`，所有捕获请求为 GET | `pending` |
| Privacy/bounding | build 成功；专项因 `bounding.js`/`normalizer.js` 不存在退出 1 | Redmine API/probe/privacy 专项 `18/18 pass`；敏感诱饵与私有备注均不可见 | `pending` |
| MCP server/stdio | `not_run` | `not_run` | `not_committed` |
| Historical evidence service | `not_run` | `not_run` | `not_committed` |
| Model services | `not_run` | `not_run` | `not_committed` |
| Collectors/runtime/gate | `not_run` | `not_run` | `not_committed` |
| Observability/UI | `not_run` | `not_run` | `not_committed` |

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
| `pnpm acceptance:redmine:offline` | `not_run` | `not_run` |

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

- Current deviation: implementation has not started.
- Remaining risk: all code, offline acceptance, real E2E, privacy audit, compatibility audit, and final master verification are pending.
