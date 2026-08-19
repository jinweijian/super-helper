# Redmine 历史案例调查运维指南

本文说明如何把 `super helper` 接入固定的 `itsupportknowledge` Redmine 工单项目。该能力只读、默认关闭，不会把凭证明文写入 `config.json`。

## 启用

先构建项目，并确认当前 workspace 指向要排查的真实项目：

```bash
pnpm build
node dist/cli.js workspace set --path /absolute/project/path --name "Project"
```

隐藏录入 API 访问键。密钥保存到 `~/.super-helper/secrets.json` 的 `integrations.redmine.apiKey`，文件权限为 `0600`；配置只保存 SecretRef。

```bash
node dist/cli.js redmine secret set
node dist/cli.js redmine probe
node dist/cli.js redmine source enable
```

`source enable` 会幂等写入：

- `company-redmine` stdio MCP server；
- `permission=read_only` 和 `historical_case/redmine` capability；
- 仅 `redmine_search_issues`、`redmine_get_issue_case_details` 两个工具；
- 当前 workspace 的 MCP allowlist 与 `historicalCaseSources`；
- 当前 Node 可执行文件的 stdio command allowlist。

MCP 子进程只接收 materialized `REDMINE_API_KEY` 环境变量，不直接读取 secrets 文件。origin 固定为 `https://redmine.codeages.work`，项目固定为 `itsupportknowledge`。

## 运行边界

每个通过 Preflight 的问题都会执行一次工单搜索；Knowledge、Experience 和完整 Redmine 分支并行。搜索最多返回 10 条候选，reranker 最多选择 3 条详情，详情总预算为 48,000 Unicode 字符，search grant 默认 60 秒。

私有备注永久删除；姓名、用户名、邮箱、IP、手机号、人员 ID、附件文件名/URL/body、未知 custom field 和原始错误不离开 MCP Server。Case 中的 Redmine evidence 只保存通用证据占位和安全 ID，不保存工单正文。

有效历史线索会合并成一个只读 Worker 请求。只有本轮 Redmine evidence 与本轮 workspace/log evidence 同时支持、没有冲突并通过既有 Review 时，才允许输出“较可能同根因”；否则只能输出不同原因、初步方向或未知。

## 进度与故障定位

Dashboard 和 `/api/logs` 会显示四类安全阶段：

1. 查询工单；
2. 分析案例；
3. 验证当前项目；
4. 交叉审核。

事件只含状态、耗时、数量、安全 ID、degraded 和 Worker 是否调用。定位故障时先看对应 completed 事件：

- `no_hit`：正常无命中，继续当前项目排查；
- `timeout`：检查网络和 MCP timeout；
- `failed`：先运行 `redmine probe`，再核对 source/capability/tool allowlist；
- Worker `rejected`：Analyzer 产生了不在只读 action allowlist 内的检查；
- 交叉审核为 partial：核对是否缺少当前 workspace/log evidence 或存在反证。

## 灰度与回滚

先只在一个 workspace 上执行 `source enable`，观察四阶段事件、Redmine 429/5xx 和 Worker 耗时。不要扩大 origin、project、候选或详情预算来绕过失败。

立即回滚：

```bash
node dist/cli.js redmine source disable
```

该命令从当前 workspace 移除历史来源和 MCP allowlist；若没有其他 workspace 使用该 server，也移除 server 配置。它不会删除 API key。需要删除密钥时应使用受控的 secrets 管理流程，不要直接把明文复制到命令行或日志。

## 离线验收

离线验收使用正式 `DiagnosticRuntime`、正式 MCP SDK stdio transport 和生产 MCP server 边界，但使用本地 fixture/model/Worker，不联网、不读取真实 key：

```bash
pnpm acceptance:redmine:offline
```

它固定覆盖 `resolved_by_ticket`、`not_resolved_by_ticket`、`direction_helpful` 三种结构结果。

## 真实 E2E manifest

真实验收 manifest 只放用户目录，不提交仓库，权限必须为 `0600`：

```json
{
  "version": 1,
  "workspaceId": "current",
  "scenarios": [
    { "id": "resolved_by_ticket", "prompt": "真实问题一" },
    { "id": "not_resolved_by_ticket", "prompt": "真实问题二" },
    { "id": "direction_helpful", "prompt": "真实问题三" }
  ]
}
```

运行：

```bash
pnpm acceptance:redmine:real -- \
  --manifest /absolute/path/redmine-case-investigation.json \
  --workspace /absolute/path/real-project
```

脚本缺 manifest、真实 Git workspace、真实模型凭证、真实 Claude Code、正式 MCP entry 或 Redmine SecretRef 时会非零退出，不会注入 fake fallback。报告只输出 scenario ID、结构状态、evidence kinds、Review 决策和只读审计，不输出 prompt、工单正文、人员、URL、凭证或 Worker 原始结果。验收创建的 Case 会在结束时删除。
