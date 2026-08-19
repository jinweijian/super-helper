# Redmine 只读连通性技术穿刺设计

日期：2026-08-20

状态：交互方案已确认，待用户审阅书面设计

## 1. 背景

`super helper` 已有通用 MCP Client、本地 `SecretRef`/`FileSecretsRepository` 和完整的 Redmine 历史案例调查设计，但尚未实现真实 Redmine API adapter 与 Redmine MCP Server。用户已经为 `https://redmine.codeages.work` 取得 API 访问键，并确认第一期只允许读取 `00技术支持工单` 项目，项目标识为 `itsupportknowledge`。

本次技术穿刺只验证最底层真实链路是否成立，不提前实现完整 MCP、Runtime 案例调查或 UI。穿刺通过后，再按现有完整设计和实施计划推进正式接入。

相关文档：

- `docs/superpowers/specs/2026-07-31-redmine-mcp-case-investigation-design.md`
- `docs/superpowers/plans/2026-07-31-redmine-mcp-case-investigation.md`

## 2. 目标

- 安全保存 Redmine API Key，不进入 Git、普通配置、命令参数或日志。
- 使用专用只读客户端连接 `https://redmine.codeages.work`。
- 验证 API Key 能读取 `itsupportknowledge` 项目。
- 解析并固定该项目的数值 project ID。
- 验证可以查询包含 open 和 closed 状态的工单列表。
- 验证可以读取一条候选工单的 journals、relations 和附件元数据。
- 只输出结构化健康状态和数量，不输出密钥、工单主题、正文、备注或附件地址。
- 默认测试完全离线；真实 Redmine 穿刺只能通过显式命令触发。

## 3. 非目标

本次不包含：

- 创建、更新、评论、指派、关闭或删除工单。
- 下载附件正文。
- 搜索相似工单、案例重排、同因判断或最终用户回复。
- Redmine MCP Server、HTTP transport 或 Runtime 编排。
- Dashboard 设置页和进度 UI。
- 修改 public API response shape 或持久化 Case JSON shape。
- 将 Redmine 工单批量同步到 Knowledge。

## 4. 方案选择

### 4.1 推荐方案：本地文件 SecretRef + 显式真实 probe

API Key 写入现有 `FileSecretsRepository`：

```text
~/.super-helper/secrets.json
```

密钥键名固定为：

```text
integrations.redmine.apiKey
```

文件继续使用现有原子写入和 `0600` 权限。Redmine 普通配置或运行参数只持有：

```json
{
  "source": "file",
  "key": "integrations.redmine.apiKey"
}
```

CLI 增加交互式密钥写入命令。密钥通过隐藏输入读取，不允许通过 `--api-key` 命令参数传入，避免进入 shell history 和进程列表。

优点：复用现有密钥设施，能够由 Codex 后续执行真实 probe，且不会污染仓库。缺点：需要增加一个很小的 CLI 密钥录入边界。

### 4.2 备选方案：临时环境变量

使用 `REDMINE_API_KEY` 只对单次 shell 生效。实现最少，但其他终端设置的环境变量不会自动传播给正在运行的 Codex，真实协作验证不稳定，也容易因 shell 操作失误泄漏。

### 4.3 拒绝方案：明文 `.env` 或 `config.json`

虽然 `.env` 已被 `.gitignore` 忽略，但明文文件容易被误复制、备份或日志化；`config.json` 还会破坏仓库现有 SecretRef 约束。因此不采用。

## 5. 模块边界

### 5.1 `src/mcp-servers/redmine/`

新增最小只读 Redmine API 边界：

```text
src/mcp-servers/redmine/
  contracts.ts
  redmine-api/
    client.ts
    protocol.ts
    error-mapping.ts
  probe.ts
```

职责：

- 固定 base URL、项目标识和允许的方法。
- 构造 Redmine GET 请求并解析严格 schema。
- 归一化认证、权限、限流、服务端错误、超时和非法 JSON。
- 返回不含正文的 probe 结果。

不得负责：

- MCP transport 或工具注册。
- Runtime 规划、Evidence Review 或 Presentation。
- 相似工单检索、模型判断或用户最终回复。

该边界是现有完整 Redmine MCP 设计中 API adapter 的最小前置切片，穿刺通过后可以继续复用，不创建一次性根级兼容入口。

### 5.2 `src/cli/`

CLI 只负责：

- 解释 `redmine secret set` 和 `redmine probe` 命令。
- 调用 `FileSecretsRepository` 或 Redmine probe service。
- 输出安全的、固定字段的健康状态。
- 用退出码表达成功或失败。

CLI 不拼接 Redmine HTTP 请求，不解析 Redmine payload，不决定项目权限。

### 5.3 `src/onboarding/`

继续由 `FileSecretsRepository` 负责本地文件 SecretRef 存取。只增加通用的安全录入调用方式，不把 Redmine 协议写入 onboarding。

## 6. 安全合同

穿刺运行时冻结如下范围：

```json
{
  "baseUrl": "https://redmine.codeages.work",
  "projectIdentifier": "itsupportknowledge",
  "permission": "read_only",
  "includePrivateNotes": false,
  "downloadAttachments": false
}
```

强制规则：

- 只允许 HTTPS。
- 只允许 host 精确等于 `redmine.codeages.work`。
- 只允许 `GET`。
- 禁止把 API Key 放入 URL；只通过 `X-Redmine-API-Key` 发送。
- 禁止 `X-Redmine-Switch-User`。
- 禁止跨 host 重定向；请求必须使用固定 origin。
- 只允许项目标识 `itsupportknowledge`，并在每次列表与详情响应中复核数值 project ID。
- 列表最多读取 1 条，分页 `limit=1`。
- 详情 issue ID 必须来自同一次列表响应，不能接受任意外部 issue ID。
- Redmine 会按 API Key 所属账号的权限决定 journals 可见范围。穿刺只统计 journal 数量并立即丢弃 notes，不持久化、不输出；正式账号必须取消“查看私有备注”权限，避免 Redmine 把私有备注返回给客户端。
- 不下载附件，只验证附件元数据字段可解析。
- 超时默认 10 秒；不做无限重试。
- 401、403、404、429、5xx 和网络错误不得包含原始响应正文。

## 7. 数据流

真实 probe 使用以下固定流程：

```text
FileSecretsRepository
  → 解析 integrations.redmine.apiKey
  → GET /projects/itsupportknowledge.json
  → 校验 identifier，取得数值 project ID
  → GET /issues.json?project_id=<id>&status_id=*&sort=updated_on:desc&limit=1
  → 复核返回 issue 的 project ID
  → GET /issues/<candidateId>.json?include=journals,relations,attachments
  → 复核详情 project ID
  → 仅输出安全 probe 状态
```

`status_id=*` 用于证明列表能够覆盖 open 和 closed 工单；它不保证本次返回样本一定是 closed。

## 8. 安全输出合同

成功输出示例：

```text
redmine secret: configured
redmine authentication: ok
redmine project: ok (identifier=itsupportknowledge, numericId=<number>)
redmine issue list: ok (sampleCount=1, includesAllStatuses=true)
redmine issue detail: ok (journals=<number>, relations=<number>, attachments=<number>)
redmine readonly probe: passed
```

允许输出：

- 固定项目标识和数值 project ID。
- HTTP 能力阶段的 `ok`/`failed`。
- 工单、journal、relation 和附件数量。
- 安全错误码，例如 `authentication_failed`、`project_forbidden`、`timeout`。

禁止输出：

- API Key、请求头或 `secrets.json` 内容。
- issue ID、主题、description、journal notes、人员姓名或邮箱。
- 附件文件名、下载 URL 或正文。
- 原始 Redmine 错误响应和堆栈。

## 9. 命令设计

构建后提供：

```text
super-helper redmine secret set
super-helper redmine probe
```

`redmine secret set`：

- 仅在交互式 TTY 下接受隐藏输入。
- 空输入失败，不修改原密钥。
- 二次输入一致后才写入。
- 成功时只输出 `redmine secret: configured`。

`redmine probe`：

- 不接受 base URL、项目、API Key 或 issue ID 参数，避免扩大穿刺范围。
- 缺少密钥时安全失败并提示先执行 `redmine secret set`。
- 真实联网是显式命令，不加入 `pnpm test`。

package script 只做命令别名，不承载业务逻辑：

```text
pnpm redmine:probe
```

## 10. 错误处理

| 情况 | 安全结果 | 退出码 |
| --- | --- | ---: |
| 密钥缺失 | `missing_credentials` | 1 |
| 401 | `authentication_failed` | 1 |
| 403 | `project_forbidden` | 1 |
| 项目 404 | `project_not_found` | 1 |
| 项目标识或 project ID 不一致 | `project_scope_mismatch` | 1 |
| 无工单 | 项目和列表通过，详情标记 `skipped_no_issue` | 0 |
| 429 | `rate_limited` | 1 |
| 超时 | `timeout` | 1 |
| 非法 JSON/schema | `invalid_response` | 1 |
| 5xx/网络失败 | `service_unavailable` | 1 |

任何失败都不得打印 API Key、原始响应正文或 URL query 中的敏感数据。

## 11. 测试策略

### 11.1 密钥测试

- API Key 只写入 `secrets.json`，普通配置和输出中不存在明文。
- 文件权限为 `0600`。
- 空输入和二次输入不一致不覆盖旧密钥。
- 测试使用临时目录，不访问真实 `~/.super-helper`。

### 11.2 API adapter 单元测试

使用 fake `fetch` 覆盖：

- 仅发送 GET。
- API Key 只进入 `X-Redmine-API-Key`。
- 固定 origin、项目标识和请求路径。
- `status_id=*`、`sort=updated_on:desc` 和 `limit=1`。
- 列表与详情 project ID 复核。
- 详情 issue ID 必须来自列表响应。
- 401、403、404、429、5xx、timeout、非法 JSON 和 schema 不匹配。
- 重定向、跨 host 和范围外项目被拒绝。

### 11.3 输出脱敏测试

- 成功和所有失败路径均不包含 fixture API Key。
- 不包含 issue ID、主题、description、notes、人员信息、附件名或 URL。
- 只保留数量、固定标识和安全状态码。

真实穿刺可以暂时使用用户当前取得的 API Key 验证 GET 链路；完整接入上线前必须替换为仅拥有该项目读取权限、且不能查看私有备注的专用服务账号 API Key。

### 11.4 验证命令

代码完成后至少运行：

```text
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

真实联网验证单独运行：

```text
pnpm redmine:probe
```

## 12. 验收标准

- 用户可以在不暴露密钥的情况下完成本地录入。
- `secrets.json` 权限为 `0600`，仓库和普通配置无明文 API Key。
- 真实 probe 只访问 `https://redmine.codeages.work` 和 `itsupportknowledge`。
- 所有网络请求均为 GET，且 API Key 只位于请求头。
- 成功验证项目、工单列表和单条详情的只读能力。
- 输出不包含工单内容、人员身份、附件定位或密钥。
- 默认 `pnpm test` 不联网、不需要真实凭证。
- 穿刺代码可以作为后续 Redmine MCP API adapter 的基础继续演进。

## 13. 穿刺通过后的下一步

穿刺通过只证明认证、权限、REST schema 和网络链路成立，不代表完整 Redmine 对接完成。后续继续按完整设计推进：

1. 建立对应 OpenSpec change 并确认正式配置合同。
2. 完成 Redmine MCP 两个只读工具。
3. 增加候选搜索、详情预算、隐私归一化和 schema-aware truncation。
4. 接入 Knowledge 与 Redmine 并行案例调查 Runtime。
5. 接入 Evidence Review、可观测性和异步 UI。

## 14. 官方接口依据

- Redmine REST API 认证与通用约定：<https://www.redmine.org/projects/redmine/wiki/REST_Api>
- Redmine Projects API：<https://www.redmine.org/projects/redmine/wiki/Rest_Projects>
- Redmine Issues API：<https://www.redmine.org/projects/redmine/wiki/rest_issues>

官方接口支持通过 `X-Redmine-API-Key` 认证、按项目 identifier 获取项目、用数值 `project_id` 查询工单、使用 `status_id=*` 覆盖 open 和 closed，以及在 issue 详情中加载 journals、relations 和 attachments。
