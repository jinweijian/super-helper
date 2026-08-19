## Why

当前 Runtime 采用 `Experience → Knowledge → MCP → Worker` 串行早停：Knowledge 或 Experience 可以在没有查询历史工单的情况下完成回复；通用 MCP 也不能完成“搜索候选、读取详情、生成排查线索、验证当前环境”的两阶段案例调查。

Redmine 固定实例与 `itsupportknowledge` 项目的只读 REST 穿刺已经在真实环境通过。现在需要把它接入正式诊断链路，并用真实 EduSoho workspace 做端到端验收，证明历史工单在“能够帮助解决、不能解决、只提供有用方向”三类场景下都不会被误用。

## What Changes

- 新增独立的 Redmine MCP Server，只提供 `redmine_search_issues` 和 `redmine_get_issue_case_details` 两个 GET-only 工具。
- 对启用 historical-case source 的 workspace，所有 Preflight `dispatch` 回合都必须查询 Redmine；模型只规划查询内容，不能决定跳过。
- Knowledge、Experience 与完整 Redmine 10→3 分支以 evidence-only 方式并行采集，任一来源不得提前完成回合。
- 固定 Redmine origin 与 `itsupportknowledge` 项目；详情只能读取本轮搜索授权的最多 3 个候选。
- 永久排除私有备注和人员身份；附件只保留 MIME、大小和数量，不返回文件名、URL 或正文。
- 新增查询规划、候选重排、历史案例分析和历史案例验证四个不可直接回复用户的 Product Agent。
- 形成有效历史线索后固定运行一次只读 Workspace Worker，同时查找支持证据和反证。
- 新增确定性历史证据门禁：历史证据只能形成排查方向；当前根因必须绑定本轮 workspace/log evidence。
- 复用现有 Review、Presentation、异步 Gateway 和 session polling，只增加安全进度事件。
- 增加真实 opt-in E2E 验收，覆盖 `resolved_by_ticket`、`not_resolved_by_ticket`、`direction_helpful` 三类结果。

## Capabilities

### New Capabilities

- `redmine-read-only-mcp`：固定范围 Redmine GET adapter、搜索/详情工具、候选授权、永久隐私过滤和结构化预算。
- `historical-case-investigation`：强制前置工单查询、并行采证、10→3 选择、自动当前验证、历史证据门禁和兼容降级。
- `real-redmine-e2e-acceptance`：真实 Redmine、真实 EduSoho workspace 和真实 Runtime 的三类端到端验收。

### Modified Capabilities

- `diagnostic-agent-runtime`：Preflight dispatch 后优先进入案例调查 collaborator。
- `multi-agent-configuration`：登记四个历史案例 Agent，全部禁止用户可见输出。
- `layered-knowledge-diagnosis`：案例调查中只采证，不提前回复。
- `validated-experience-reuse`：案例调查中只提供候选历史 evidence，不提前回复。
- `runtime-observability-hygiene`：增加安全阶段事件和 Dashboard 进度映射。

## Impact

- 扩展 `src/mcp-servers/redmine/`、`src/mcp/`、workspace/MCP 配置和 package bin。
- 新增 `src/runtime/case-investigation/`，并为 Knowledge、Experience、Worker 暴露无提前呈现的 collect 边界。
- 新增四个 `src/agents/` 配置与 registry 条目。
- 新增离线 fixtures、专项测试、真实 E2E 脚本、运维 runbook 和 `implementation-notes.md` 验证记录。
- Gateway route 与公共 response shape 不变；旧配置和旧 Case JSON 继续可读。
- 默认测试完全离线；真实 E2E 必须显式运行且只执行 GET 和只读 workspace 检查。
