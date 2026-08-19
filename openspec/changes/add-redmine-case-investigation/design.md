## Context

权威产品设计为 `docs/superpowers/specs/2026-08-20-redmine-first-case-investigation-design.md`。它取代 2026-07-31 设计中与以下决策冲突的部分：Redmine 查询不再由模型选择；私有备注永久关闭；形成有效历史线索后固定运行一次只读 Worker；第一阶段只支持 `itsupportknowledge`。

当前已具备：

- 通用 MCP Client、workspace/tool allowlist、stdio/HTTP/SSE transport 和 20K 普通结果归一化。
- Knowledge、Experience、Claude Code Worker、Evidence Review、同步/异步 Gateway。
- 固定 Redmine origin/project 的 GET-only client、隐藏密钥录入和真实 probe。
- 本机真实 workspace `/Users/king/website/edusoho`，用于显式 E2E；该路径不能硬编码进生产代码或默认测试。

Redmine 官方依据（访问日期 2026-08-20）：

- REST API 认证：<https://www.redmine.org/projects/redmine/wiki/REST_Api>
- Issues API：<https://www.redmine.org/projects/redmine/wiki/rest_issues>
- Search API：<https://www.redmine.org/projects/redmine/wiki/Rest_Search>
- Journals：<https://www.redmine.org/projects/redmine/wiki/Rest_IssueJournals>

## Goals / Non-Goals

**Goals:**

- 对启用来源的 workspace，每个 Preflight `dispatch` 回合恰好执行一次有界 Redmine 搜索。
- Knowledge、Experience 与 Redmine 并行采证，Redmine 使用 10→3 两阶段读取。
- 历史工单只生成 evidence-bound 排查线索；有效线索固定触发一次只读 Worker 验证。
- 当前结论由本轮 workspace/log evidence 支撑；历史 evidence 不能冒充当前事实。
- Redmine 失败时 fail-open，但保留准确来源缺口。
- 默认离线测试与真实三类 E2E 同时成立。

**Non-Goals:**

- Redmine 创建、更新、评论、关闭、删除或附件下载。
- 私有备注、人员身份、附件文件名或正文进入模型。
- 多项目选择、Jira/禅道 adapter、工单全量同步。
- 为了通过 E2E 注入假的历史结论、假的 Worker evidence 或测试专用生产分支。
- 在当前 change 强制交付 Streamable HTTP transport；本地和真实验收使用 stdio，远程部署另行变更。

## Decisions

### 1. Preflight dispatch 后强制进入案例调查

`DiagnosticRuntime` 在 Preflight `dispatch` 后调用 `CaseInvestigationTurnService.answer()`。只要 workspace 配置了可用 historical-case source，就不能再让 Experience 或 Knowledge 提前结束回合。

模型 `Historical Search Query Planner` 只输出 `query`、`signals`、固定 `status=all`、`candidateLimit=10` 和 `detailLimit=3`。失败时使用 `answerGoal.resolvedQuestion` 与空 signals，仍执行一次搜索。代码不得重新使用中文关键词或问题类型决定是否查询。

旧 workspace 无 historical source 时继续可读并走旧链路；目标 workspace 缺少来源配置不得算作真实验收通过。

### 2. Redmine MCP 固定范围且仅两个工具

`src/mcp-servers/redmine/` 是独立边界，不导入 Runtime、Gateway、Worker、Session 或 Knowledge。

- origin 固定为 `https://redmine.codeages.work`。
- project identifier 固定为 `itsupportknowledge`，启动时解析并冻结数值 ID。
- API Key 只通过 `X-Redmine-API-Key` 发送。
- 工具 input 不接受 URL、method、headers、project 或凭证。
- 只暴露 `redmine_search_issues` 与 `redmine_get_issue_case_details`。
- `searchId` 保存短 TTL 候选授权；详情只接受本轮候选中的 1–3 个唯一 ID。

本地/真实验收使用 stdio transport。`super-helper-redmine-mcp` bin 从环境中的 `REDMINE_API_KEY` 读取已经由主应用 SecretRef materialize 的值，不自行读取用户 secrets 文件。

### 3. Search backend、缓存和错误语义

启动配置固定一个 backend：

- `rest_search`：`/search.json` 后对候选做数值项目 ID 复核。
- `issues_scan`：`/issues.json?project_id=<id>&status_id=*&sort=updated_on:desc`，有界页数/历史窗口后本地词法召回。

请求期间不能静默切换 backend 或扩大项目范围。`issues_scan` 归一化页结果允许进程内缓存 5 分钟，不落盘。

安全状态为 `completed | no_hit | timeout | failed`；只有成功空结果才是 `no_hit`。401/403/非法 schema 不重试，429/5xx 最多一次且不能突破来源预算。

### 4. 隐私过滤先于 MCP 输出

永久规则：

- 删除 `private_notes=true` 的 journals，无配置开关。
- 删除姓名、用户名、邮箱、IP、手机号和人员数值 ID。
- 附件只保留 MIME、大小和数量；删除文件名、URL、token、cookie 和正文。
- 自定义字段使用显式 allowlist；未知字段删除。
- 原始 payload、原始错误和 API Key 不进入 MCP result、Case、日志、fixture 或 E2E 记录。

三条详情总预算 48,000 Unicode 字符。通过删除完整低优先级 evidence block 收缩，不能切断序列化 JSON；必须返回完整 block 和 truncation metadata。

### 5. 并行 evidence-only collection

`ParallelSourceCollector` 使用 `Promise.allSettled` 同时启动：

- Knowledge collect：返回 route、evidence pack、judge、answerability、provenance 和 context patch；不创建 Run/回复。
- Experience collect：返回可复用/被拒绝候选 evidence；不创建 Run/回复。
- Redmine branch：search → schema-constrained rerank → detail；分支内部严格串行。

各分支返回独立 outcome，不并发修改共享 `DiagnosticRequest`。Barrier 完成后再聚合；任何来源先完成都不能创建正式回复。

### 6. 四个 Product Agent

- `historical-search-query-planner`：生成查询，不决定是否查。
- `historical-case-reranker`：只能选择搜索候选内最多 3 个唯一 ID。
- `historical-case-analyzer`：提取历史事实、冲突、假设和 expected-match/expected-mismatch 只读 checks。
- `historical-case-verifier`：只引用已有 evidence ID，分类为 `same_root_cause_likely | same_symptom_different_cause | diagnostic_lead_only | irrelevant`。

全部配置在 `src/agents/` 并登记到 `registry.json`，`mayProduceUserFacingText=false`。不存在决定是否启动 Worker 的 Assessor Agent。

### 7. 有效历史线索固定触发一次 Worker

Analyzer 输出通过 schema、evidence ID 和 action allowlist 校验后，只要至少一条 lead 有非空 checks，Runtime 固定调用一次 `DiagnosticWorker`：

- ephemeral request 包含有界历史假设和只读 checks。
- persisted request 删除历史正文、模型 reason 和完整验证计划。
- Worker 同时寻找支持条件与反证，不查询 Redmine、不分类同因、不直接 Review/Presentation。
- 案例验证不执行普通 deep-query follow-up。
- Analyzer 无有效 lead 时，仍可根据 Knowledge 缺口走既有普通 Worker 路径。

允许 action 仅为 `read_file | search_workspace | inspect_config | inspect_log | run_read_only_command`。任何写文件、数据库写、网络写或 Redmine 写在派发前拒绝。

### 8. 确定性历史证据门禁和一次呈现

`same_root_cause_likely` 只有在以下条件同时成立时才能进入既有 Review：

- 至少一个本轮有效 `workspace` 或 `log` coverage envelope。
- 至少一个本轮 read-only、allowlisted、completed 的 Redmine `mcp` envelope。
- 所有 claim/evidence ID 存在于本轮集合。
- 没有 Worker 反证或关键 Knowledge/版本/配置冲突。

只有历史 evidence 时降级为 `diagnostic_lead_only`。Redmine timeout/failed 时不能说“没有类似工单”。所有来源与 Worker 只采证，Runtime 最终只创建一个 Run、一次 Review、一次 Presentation 和一条正式回复。

### 9. Turn-local 状态、兼容与可观测性

搜索 query/signals、未选候选、未引用工单详情、模型 reason 和 ephemeral Worker plan 只在当前 turn 内存在。正式 Run 只持久化清洗后的 request、被 Review 使用的有界 evidence/claims、来源状态/数量/耗时和安全错误码。

Gateway response shape、旧 Case JSON 和旧配置保持兼容。Dashboard 复用现有 async 202 与 session polling，增加“查询知识与工单、分析案例、验证当前环境、交叉审核”进度标签。事件 detail 不记录 query、正文、身份、URL、token、reason、验证计划或 raw error。

### 10. 预算

| 阶段 | 默认上限 |
| --- | ---: |
| Query planner | 6 秒 |
| Redmine 搜索 | 8 秒 |
| Candidate rerank | 6 秒 |
| Redmine 详情 | 10 秒 |
| Redmine 分支总预算 | 25 秒 |
| Knowledge/Experience/Redmine barrier | 30 秒 |
| Worker | 现有配置，案例验证最多一次 |

### 11. 真实三类 E2E 是完成门禁

真实验收必须使用：

- 真实 `redmine.codeages.work` 只读 API。
- 固定 `itsupportknowledge` 项目。
- 真实 `/Users/king/website/edusoho` workspace 或通过显式参数传入的等价真实项目路径。
- 正式 `DiagnosticRuntime`、正式 MCP stdio transport、正式模型和正式只读 Worker。

三类场景：

1. `resolved_by_ticket`：历史线索产生 checks，Worker 在当前项目找到支持证据，最终结论同时绑定 Redmine 与 current evidence。
2. `not_resolved_by_ticket`：没有相关工单或历史 evidence 不足/冲突，系统不能把工单包装成解决方案，并继续使用其他证据或显式保留 unknown。
3. `direction_helpful`：历史 evidence 形成有用排查方向，但当前证据不足以确认根因，最终只能输出初步方向。

场景输入存放在用户目录的显式 manifest 或命令参数中，不提交真实工单正文。验收记录只保存 scenario ID、分类、source status、evidence kinds/IDs、Review decision、HTTP method 计数和安全错误码。

E2E 必须检查 Redmine 请求全部为 GET、没有写工具、没有私有备注/身份/原始正文泄漏。任一场景未达到预期分类或 evidence gate 均失败，不能用人工主观判断替代。

## Risks / Trade-offs

- **每题查询增加延迟**：并行 collector、有界预算、5 分钟内存缓存和异步进度。
- **历史案例相似但过时**：当前 evidence 必需、反证 checks 和确定性门禁。
- **Search API 不可用**：启动时固定 `issues_scan`，运行期不动态扩大范围。
- **真实 E2E 随外部数据变化**：manifest 使用稳定问题意图与结构化门禁，不断言工单正文；失败时记录来源状态，不能自动改期望。
- **现有独立工作树有未提交修改**：保持只读，实施基于最新 master 重新实现或经审计后摘取，禁止覆盖用户改动。

## Migration Plan

1. 修订 OpenSpec 并保留现有脏工作树。
2. 合并 workspace historical source 配置和兼容验证，功能默认未配置。
3. 实现离线 Redmine MCP、stdio transport 和固定范围工具。
4. 实现 Runtime collectors、Agents、自动 Worker 和 gate。
5. 增加 Dashboard 进度、runbook、offline acceptance 和 E2E harness。
6. 将本机 current workspace 配置为 `company-redmine`，SecretRef 指向 `integrations.redmine.apiKey`。
7. 运行三类真实 E2E、全量验证和 anti-fake-complete audit。
8. 所有证据通过后提交到 `master`；不 push，除非用户另行要求。

回滚时删除 workspace 的 `historicalCaseSources` 或禁用 MCP server；旧 Runtime 链路继续可用，无 Case 数据迁移。

## Completion Gate

- `openspec status --change add-redmine-case-investigation --json` 可解析且 artifacts 完整。
- 新行为全部经过 TDD red/green 证据。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`、`pnpm test:web` 全部通过。
- offline acceptance 不联网且覆盖权限、隐私、并行和分类门禁。
- 三类真实 E2E 全部通过，记录到 `implementation-notes.md`，不包含敏感正文。
- 生产代码和默认测试无 Redmine write endpoint、write tool 或真实 secret。
- 当前 master 工作区干净，目标提交可追溯，现有外部工作树未被修改。
