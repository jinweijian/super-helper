## 1. 配置与能力合同

- [x] 1.1 在 `test/historical-case-config.test.mjs` 先写失败测试：旧 workspace 无字段可读；配置 source 可 round-trip；未知/disabled/read_write/未 allowlist server、错误 capability、多 source 均拒绝。完成证据：构建后专项测试因合同缺失而失败，失败原因与预期一致。
- [x] 1.2 在 `src/contracts/base.ts`、`src/config/contracts.ts`、`src/mcp/contracts.ts` 增加 `HistoricalCaseSourceConfig` 与 `historical_case/redmine` capability；source 只含 `serverId`，不含项目或私有备注开关。完成证据：类型定义不包含 URL、project、credential、`includePrivateNotes`。
- [x] 1.3 在 `src/config/io.ts` 和 `src/onboarding/config-commit.ts` 实现配置校验与保留逻辑；`src/config/defaults.ts` 保持历史来源默认未配置。完成证据：`pnpm build && node --test test/historical-case-config.test.mjs test/onboarding.test.mjs` 通过。

## 2. Redmine 搜索协议与固定范围 Client

- [x] 2.1 在 `test/redmine-api-client.test.mjs` 先写失败测试：Search/Issues API GET 参数、`status_id=*`、固定 origin/project、候选项目复核、有界分页、timeout/401/403/429/5xx/非法 schema 安全错误。完成证据：测试先因方法/schema 缺失而红。
- [x] 2.2 扩展 `src/mcp-servers/redmine/redmine-api/protocol.ts` 与 `client.ts`，增加搜索页、候选字段、公开 journal/status changes/relations/attachment metadata 的严格 Zod schema 和 GET 方法；保留 probe 现有最小接口。完成证据：所有请求方法为 GET，输入无法设置 URL/method/header/project。
- [x] 2.3 新建 `src/mcp-servers/redmine/redmine-api/search.ts`，实现启动时固定的 `rest_search | issues_scan` backend、固定项目复核、历史窗口、页预算和 5 分钟进程缓存。完成证据：专项测试证明请求期间不切换 backend、不扩大项目范围、缓存不落盘。

## 3. 永久隐私过滤与结构化预算

- [x] 3.1 新建 `test/redmine-normalizer.test.mjs` 和敏感 fixtures，先写失败测试覆盖 private journals、姓名/用户名/邮箱/IP/手机号/人员 ID、附件文件名/URL/token/body、未知 custom fields 和 raw error。完成证据：测试先证明未实现路径会泄漏诱饵。
- [x] 3.2 新建 `src/mcp-servers/redmine/redmine-api/normalizer.ts`，仅输出候选/详情白名单；私有备注永久删除，人员字段全部删除，附件只保留 MIME/size/count。完成证据：序列化结果不含任何诱饵或 `includePrivateNotes` 分支。
- [x] 3.3 新建 `src/mcp-servers/redmine/redmine-api/bounding.ts`，按完整 evidence block 将三条详情收缩到 48,000 Unicode 字符并返回 omitted/truncated metadata。完成证据：超限 fixture 仍是合法 schema，任何 block 不被半截切断。

## 4. 两个 Redmine MCP 工具与 stdio transport

- [x] 4.1 在 `test/redmine-mcp-server.test.mjs` 先写失败测试：只发现两个工具、输入 schema 禁止 transport/project/credential、search 最多 10、detail 只接受 live grant 中最多 3 个唯一 ID。完成证据：测试先因 server/grant 缺失而红。
- [x] 4.2 新建 `src/mcp-servers/redmine/candidate-grants.ts`、`tools/search-issues.ts`、`tools/get-issue-case-details.ts` 和 `server.ts`，实现 TTL grant、固定项目复核和安全错误。完成证据：未知/过期/重复/越限 ID 在 Redmine detail fetch 前被拒绝。
- [x] 4.3 新建 `src/mcp-servers/redmine/config.ts`、`transports/stdio.ts` 和薄 `main.ts`；进程只接收 materialized `REDMINE_API_KEY` 与有界 backend/预算配置，不读取 secrets 文件。完成证据：`test/redmine-mcp-stdio.test.mjs` 通过真实 MCP SDK stdio transport 完成 listTools/search/detail fixture 流程。
- [x] 4.4 更新 `package.json` bin/scripts 和 build contract，增加 `super-helper-redmine-mcp`、`acceptance:redmine:offline`、`acceptance:redmine:real`。完成证据：`pnpm build` 后 `dist/mcp-servers/redmine/main.js` 存在且普通 `super-helper` bin 不变。

## 5. 主应用 HistoricalCaseEvidence 边界

- [x] 5.1 在 `test/historical-case-evidence-service.test.mjs` 先写失败测试：配置/allowlist、search→detail 同一 grant、状态映射、48K structured result、provenance 和历史结果不得直接生成 final answer。完成证据：测试因 service/capability 缺失而红。
- [x] 5.2 扩展 `src/mcp/normalizer.ts`，仅对显式 `historical_case/redmine` capability 使用 schema-aware 48K 路径；普通 MCP 保持 20K。完成证据：legacy MCP 专项与 historical structured 专项同时通过。
- [x] 5.3 新建 `src/mcp/historical-case-evidence-service.ts`，通过 `executeMcpTool` 调用两个工具并返回 `completed | no_hit | timeout | failed`、有界 payload、Evidence 和 current-run coverage envelopes。完成证据：timeout/failed/no_hit 不互换，readOnly/allowlisted/completed provenance 可验证。

## 6. 四个 Product Agent 与模型服务

- [x] 6.1 新建四个 Agent 配置：`historical-search-query-planner.md`、`historical-case-reranker.md`、`historical-case-analyzer.md`、`historical-case-verifier.md`，并更新 `src/agents/registry.json`、`README.md` 与 Agent stage 类型。完成证据：全部 `mayProduceUserFacingText=false`，不存在 Current Evidence Assessor。
- [x] 6.2 在 `test/historical-case-model-services.test.mjs` 先写失败测试：query planner fallback 仍查询、reranker 只能选候选 3 个、Analyzer 绑定 evidence/check/action、Verifier 不新增事实或未知 ID。完成证据：每个模型服务至少一次合法、非法 JSON、schema 越界和模型异常红绿循环。
- [x] 6.3 在 `src/runtime/case-investigation/` 新建 `contracts.ts`、`query-planner-service.ts`、`candidate-reranker-service.ts`、`historical-case-analyzer-service.ts`、`historical-case-verifier-service.ts`；使用集中 Agent config 和严格 Zod/确定性校验。完成证据：模型 reason/raw output 不进入返回给持久化层的对象。

## 7. Evidence-only collectors

- [x] 7.1 在 `test/case-investigation-collectors.test.mjs` 先写失败测试：Knowledge collect、Experience collect、Worker collect 都不创建 Run、Review、Presentation 或 helper reply，也不并发修改共享 request。完成证据：现有 answer/diagnose 路径保持原回归。
- [x] 7.2 从 `src/runtime/knowledge-turn.ts` 拆出 `collect()`，返回 route/evidence/judge/answerability/provenance/context patch；`answer()` 复用 collect。完成证据：Knowledge 可回答时 collect 仍只返回 evidence。
- [x] 7.3 从 `src/runtime/experience-turn.ts` 拆出 `collect()`，返回可复用和 rejected candidates；`answer()` 保持 legacy 行为。完成证据：配置案例调查时 Experience 不短路。
- [x] 7.4 从 `src/runtime/worker-diagnosis.ts` 拆出 `collectEvidence()`，只调用一次 worker、不运行 deep-query follow-up、不 Review/Presentation；校验 action allowlist 和 match/mismatch。完成证据：ephemeral request 含 checks，persisted request/Case 不含完整计划或历史正文。

## 8. 并行调查编排与自动 Worker

- [x] 8.1 在 `test/case-investigation-runtime.test.mjs` 用 deferred Promise 先写失败测试：Knowledge、Experience、完整 Redmine 分支同时启动；任何快分支不能提前回复；barrier 保留每个 terminal status。完成证据：测试在 collector 缺失时红。
- [x] 8.2 新建 `src/runtime/case-investigation/parallel-source-collector.ts` 与 `redmine-branch.ts`，实现 `Promise.allSettled` barrier 和 Redmine 内部 search→rerank→detail。完成证据：每个 configured dispatch 恰好一次 search，最多一次 detail call。
- [x] 8.3 新建 `worker-verification.ts`，把所有有效 leads 合成一次 bounded read-only Worker request；任何 write/unknown action 阻止派发。完成证据：三条历史案例仍只调用一个 Worker。
- [x] 8.4 新建 `case-investigation-turn-service.ts` 并修改 `src/runtime/diagnostic-runtime.ts`：Preflight dispatch 后、旧 early-return 前进入 collaborator；无 source 时走旧路径。完成证据：配置 workspace 的 Experience/Knowledge 不早停，legacy workspace 行为不变。

## 9. 历史证据门禁、结果构建与一次呈现

- [x] 9.1 在 `test/historical-case-gate.test.mjs` 先写失败测试：双侧当前/历史 evidence 通过；仅历史、旧 envelope、user claim、source failure、Worker 反证、Knowledge 冲突均降级。完成证据：测试明确区分 `same_root_cause_likely`、`diagnostic_lead_only`、`same_symptom_different_cause`。
- [x] 9.2 新建 `historical-case-gate.ts` 与 `result-builder.ts`，只使用本轮已引用 evidence 构建带 role/answers 的 claims，并向既有 Review 提供稳定 upstream blockers。完成证据：accepted primary coverage 仍由现有 AnswerGoal/Review 冻结。
- [x] 9.3 在 turn service 中只创建一个 sanitized Run，并只调用一次 `ReviewPresentationService.reviewAndFormat()` 与 `completePresentedTurn()`。完成证据：多来源+Worker 场景只有一个正式 helper reply，public DTO shape 不变。

## 10. 安全事件与 Dashboard 进度

- [x] 10.1 在 `test/case-investigation-observability.test.mjs` 先写失败测试：Agent/MCP/Worker actor 身份正确，event detail 不含 query、signals、body、identity、URL、key、reason、plan、raw error。完成证据：敏感诱饵对 Case JSON 和 `/api/logs` 均不可见。
- [x] 10.2 新建 `src/runtime/event-recorder/case-investigation.ts` 并在各阶段记录白名单状态、耗时、数量、IDs、degraded 和 Worker flag；更新 recorder index。完成证据：observability 只转换展示，不参与决策。
- [x] 10.3 更新 `src/observability/`、Dashboard 进度映射、`docs/standards/development.md`、`docs/standards/module-boundaries.md`、`docs/architecture/overview.md` 与 `docs/architecture/agents.md`。完成证据：UI 测试显示查询工单、分析案例、验证当前项目、交叉审核四类进度。

## 11. 离线验收、隐私与兼容

- [x] 11.1 新建 `test/redmine-case-investigation-offline.test.mjs`，使用真实 MCP SDK stdio fixture + 正式 Runtime 覆盖 resolved/not-resolved/direction-helpful 三类结构门禁。完成证据：`pnpm acceptance:redmine:offline` 在无网络/无真实 key 时通过。
- [ ] 11.2 增加模块边界、仅两个读工具、无 Redmine write endpoint、默认测试不联网、Case/DTO 泄漏和旧配置/旧 Case 兼容扫描。完成证据：专项测试与 `pnpm test` 同时通过。
- [x] 11.3 新建 `docs/operations/redmine-case-investigation.md`，写明配置、SecretRef、stdio 启动、预算、灰度、回滚、真实 E2E manifest 和故障定位；示例不得包含真实工单正文或凭证。

## 12. 真实项目三类 E2E

- [x] 12.1 新建 `scripts/verify-redmine-case-investigation-real.mjs`：显式读取用户目录 manifest 和现有 SecretRef，校验真实 workspace/git、真实模型、真实 Worker、正式 MCP stdio/Runtime；缺任一前置条件非零退出，不允许 fake fallback。
- [ ] 12.2 在不打印正文的情况下用真实 Redmine 搜索与真实 EduSoho workspace 建立三个稳定场景：`resolved_by_ticket`、`not_resolved_by_ticket`、`direction_helpful`。manifest 存在用户目录且不提交；完成证据只记录 scenario ID 与安全结构预期。
- [ ] 12.3 运行 `pnpm acceptance:redmine:real -- --manifest <absolute-path> --workspace /Users/king/website/edusoho`。完成证据：三类均 PASS；resolved 同时有 current+redmine evidence；not-resolved 无历史冒充结论；direction-helpful 有初步方向且无确认根因。
- [ ] 12.4 审计真实运行的 Redmine HTTP methods、工具名、Case JSON、logs 和报告。完成证据：全部 Redmine 请求为 GET；只调用两个读工具；无私有备注、身份、raw payload、URL、key 或 write action；安全结果写入 `implementation-notes.md`。

## 13. Anti-Fake-Complete Audit / 回头重新思考

- [ ] 13.1 逐入口追踪真实数据：CLI/配置 → MCP stdio → Redmine REST → search grant → details → Analyzer → Worker → gate → Review → Presentation，确认没有只建接口未接生产 composition。完成证据：在 `implementation-notes.md` 列出每个边界的生产调用证据。
- [ ] 13.2 审计 mock 假绿风险：默认 offline tests 使用正式 SDK/Runtime 边界；真实 E2E 不注入 fake client/evidence/model/worker；三类期望不能按实际输出自动改写。完成证据：脚本源代码和运行参数复核记录。
- [ ] 13.3 审计模块边界、旧 artifact/cache/schema、默认联网/费用、secrets/正文/用户数据泄漏和外部 API 假设；发现问题必须反向修改 design/spec/tasks/代码并重新验证，不能只记录“已检查”。

## 14. 全量验证与 master 收尾

- [ ] 14.1 运行 `openspec status --change add-redmine-case-investigation --json`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、所有 Redmine/案例调查专项、`pnpm test`、`pnpm test:web`、offline acceptance。完成证据：命令 exit 0，完整计数写入 `implementation-notes.md`。
- [ ] 14.2 重新运行三类真实 E2E 和生产隐私/写操作扫描；检查 `/Users/king/website/edusoho` 与外部 `codex/redmine-case-investigation` 工作树均无本任务写入。完成证据：三个场景 exit 0、外部 worktree dirty diff 与实施前一致。
- [ ] 14.3 对照 proposal/design/spec/tasks/实施计划逐条审计完成度，所有 checkbox 有直接证据后再提交到 `master`；不得用局部测试或技术 probe 代替完整目标。
