# 自适应代码排查模式设计

## 背景

当前代码排查统一通过 Claude Code Worker 执行。历史 Worker trace 显示，成功调用的延迟中位数约为 99 秒，长尾可达到数分钟；可解析样本中模型/API 时间约占总耗时的 97%，中位数约 19 个 agentic turns，最高达到 62 turns。当前 Worker 未显式固定模型或 effort，并继承全局 `CLAUDE_CODE_EFFORT_LEVEL=max`，导致事实查找类问题也可能进入高成本、无界的深度搜索。

本设计在不改变 `AnswerGoal`、Evidence Review 和 Presentation 权威边界的前提下，引入每回合“自动 / 快速 / 深度”排查模式。页面只表达用户偏好，Runtime 负责解析具体执行策略，Worker 仍只产生候选 evidence/claims，不直接回复用户。

本设计与 `openspec/changes/research-fast-code-investigation` 的评测工作相互配合：该 research change 负责校准具体模型、turn 数和质量门槛；本设计定义未来生产能力的交互、合同和运行时边界。

## 目标

- 默认由系统自动选择快速或深度排查，普通用户无需理解模型和 CC 参数。
- 允许用户仅对当前消息覆盖为“快速”或“深度”。
- 自动模式在快速结果证据不足时最多升级一次深度排查。
- 手动快速是硬约束，不自动升级。
- 深度排查按证据进展决定是否继续，不使用短时硬超时作为正常终止条件。
- 保持 `AnswerGoal`、`DiagnosticRequest`、Evidence Review、Presentation、Case 隔离和只读 Worker 安全合同。
- 旧客户端、旧 Case 和现有 API response shape 保持兼容。

## 非目标

- 不把模型、effort、turns、timeout 等底层参数直接交给聊天用户。
- 不通过固定中文问法或关键词列表选择主答或排查模式。
- 不让 Worker profile 改变 `AnswerGoal.mustAnswerItems`。
- 不在本设计中确定永久的 Fast `maxTurns` 数值；该值必须由真实问题 benchmark 校准。
- 不用 DeepSeek Harness 替换 Claude Code Worker；两者的比较仍属于独立 research spike。

## 产品交互

### 聊天输入区

输入框操作区增加“排查模式”选择器：

```text
[ 自动 ▾ ]  输入问题……                                      [发送]
```

三个选项为：

- `自动`：默认值。Runtime 根据当前问题和已有证据选择 Fast 或 Deep；Fast 未通过 Evidence Review 时最多自动升级一次 Deep。
- `快速`：仅对当前消息执行有界排查；证据不足时返回初步判断或缺失信息，不自动升级。
- `深度`：仅对当前消息直接进入 Deep，不先执行 Fast。

手动选择只影响下一次发送。消息发送成功后，选择器立即恢复为 `自动`。已发送消息及运行进度可以展示安全模式状态，例如 `自动 → 深度`，但不得展示模型内部 reason 或 prompt。

### 进度与停止

Deep 运行时页面显示脱敏进度：

- 当前阶段：定位候选、阅读代码、验证假设、整理证据；
- 已执行的搜索次数；
- 已检查的唯一文件数量；
- 最近一次有效活动时间；
- 是否由 Auto Fast 升级而来。

页面提供“停止排查”。停止必须传播到 Runtime 和对应 Worker 子进程，而不只是停止浏览器轮询。停止后：

- 若已有通过审核的 claims，则返回带边界的初步结果；
- 否则将当前回合标记为 interrupted，并允许沿用原消息模式重试。

原始工具输入、文件正文、模型思维、完整 stdout/stderr 不得进入页面、Case 或 `/api/logs`。

## 方案比较与选择

### 方案 A：页面直接传递 CC 参数

页面直接提交 `effort`、模型和 turn 限制。实现简单，但把 Worker 供应商协议泄漏到 Gateway/UI，普通用户必须理解底层参数，也无法稳定处理自动升级和审计。

### 方案 B：所有问题先 Fast 再 Deep

所有问题先执行 Fast，证据不足再升级。逻辑统一，但明显复杂的问题会白跑一轮，增加总延迟和成本。

### 方案 C：Runtime 持有调查策略（采用）

页面只提交用户偏好；Runtime 在 Worker dispatch 前使用已有结构化信号解析 Fast/Deep profile。明显复杂问题直接 Deep，不确定问题先 Fast；Fast 结果必须经过 Review 后才能决定是否升级。

该方案保持控制流为：

```text
Gateway preference
  -> Runtime investigation policy
  -> DiagnosticWorker profile
  -> DiagnosticResult
  -> Evidence Review
  -> Presentation
```

## 合同设计

### Gateway 请求

`POST /api/chat` 增加可选字段：

```json
{
  "message": "为什么订单没有关闭？",
  "investigationPreference": "auto"
}
```

取值只能是 `auto | fast | deep`。字段缺失时按 `auto`；非法值返回 400。同步和异步聊天必须使用相同字段和 Runtime pipeline。

Gateway 只验证和转发该偏好，不得在 route 中选择模型、effort、turns 或 Worker。

### Case 持久化

调查偏好绑定到对应用户消息：

```ts
interface UserMessage {
  investigationPreference?: 'auto' | 'fast' | 'deep';
}
```

该字段为可选的向后兼容新增字段：

- 旧 Case 缺失时按 `auto` 读取；
- 不批量重写历史 Case；
- 新消息保存显式偏好；
- 服务重启后的 retry 从原用户消息恢复偏好，不读取页面当前选择。

这是持久化 Case JSON shape 的兼容扩展，实施 change 必须补充旧 fixture 读取、新字段 round-trip 和 interrupted retry 测试。

### Runtime 执行策略

Runtime 在创建 Worker Run 前冻结执行策略，并放入该 Run 的 `DiagnosticRequest`：

```ts
interface InvestigationExecution {
  requestedMode: 'auto' | 'fast' | 'deep';
  resolvedProfile: 'fast' | 'deep';
  attempt: 1 | 2;
  escalationAllowed: boolean;
}
```

规则为：

- 手动 `fast`：`resolvedProfile=fast`、`escalationAllowed=false`；
- 手动 `deep`：`resolvedProfile=deep`、`escalationAllowed=false`；
- Auto 首次 Fast：`attempt=1`、`escalationAllowed=true`；
- Auto 升级 Deep：新建独立 Run，`attempt=2`、`resolvedProfile=deep`、`escalationAllowed=false`；
- Auto 直接 Deep：`attempt=1`、`escalationAllowed=false`。

`InvestigationExecution` 不进入 `AnswerGoal`，不得改变 `mustAnswerItems`，也不得被 Presentation 当作事实或结论来源。

## 自动路由

Profile Resolver 位于已有 Experience / Knowledge / MCP 收集之后、Worker dispatch 之前。它不得新增一次模型调用，而是复用已有结构化结果作确定性判断。

### Fast 信号

在以下结构化条件成立时优先 Fast：

- Knowledge/Retrieval 已提供明确、数量有界的候选文件或 artifact targets；
- 问题范围集中在一个配置、字段、入口或少量候选代码位置；
- 当前证据没有冲突；
- 不需要历史案例与当前项目交叉验证；
- 不是上一轮 Fast 失败后的继续调查。

### Deep 信号

出现以下任一条件时直接 Deep：

- 需要历史案例与当前项目交叉验证；
- 当前证据存在冲突；
- 需要跨多个模块追踪调用链或状态变化；
- 没有可靠候选文件，需要从现象开始形成并验证假设；
- Auto Fast 已经证明局部搜索不足。

无法明确判断时先 Fast，再由 Evidence Review 决定是否升级。路由不得使用固定中文问法列表。

### 审计事件

Runtime 只记录安全枚举：

```text
requestedMode: auto | fast | deep
resolvedProfile: fast | deep
reasonCode:
  bounded_candidates
  cross_module
  evidence_conflict
  historical_verification
  fast_review_incomplete
```

事件不得包含用户 query、模型 reason、Worker plan、文件正文或完整工具参数。

## Worker Profiles

Profile 配置属于 Worker/config/settings 边界，不属于 Gateway 或 UI。

### Fast Profile

Fast 用于验证有界候选，不承担开放式排查：

```text
model              = 经 benchmark 验证的 Flash/Haiku 路由
effort             = low
maxTurns           = 由 benchmark 校准的正整数
promptSuggestions  = false
artifactTargets    = 优先使用 Runtime 已找到的候选文件
searchPolicy       = 候选文件优先，只允许一次扩大搜索
```

Fast 达到 turn 边界后：

- 有 accepted fact/inference claims 时返回明确标记的初步判断；
- 没有可用证据时说明快速排查未定位；
- 手动 Fast 停止；
- Auto Fast 交给 Review 判断是否升级。

`error_max_turns` 必须转换为有界 partial，不能触发现有通用 follow-up 逻辑用同一 Fast profile 盲目重跑。

### Deep Profile

Deep 用于跨模块追踪、假设验证和冲突处理：

```text
model              = 经 benchmark 验证的强模型路由
effort             = high，不继承当前全局 max
maxTurns           = 不设置普通短上限
timeout            = 保留 20 分钟异常进程安全兜底
promptSuggestions  = false
searchPolicy       = 允许跨模块形成假设并寻找支持和反证
```

20 分钟 timeout 仅处理失控或失联进程，不是正常任务 SLA。页面可以展示通常耗时，但不得据此终止任务。

Deep Query follow-up 只能在前一 Run 产生可验证进展时发生。进展至少满足一项：

- 新增可接受 evidence；
- 发现新的 artifact target；
- 覆盖新的 `mustAnswerItem`；
- 新证据明确支持或反驳既有假设。

仅重复搜索、重复访问相同目标或改写相同结论不算进展。没有进展时停止并返回 partial/missingInfo。

## Worker 流式进度

Deep Worker 使用 Claude Code `stream-json` 输出以获得工具和活动事件。Claude adapter 负责：

- 消费流式协议并组装最终 `DiagnosticResult`；
- 将工具活动转换为脱敏计数和阶段；
- 更新 `lastActivityAt`；
- 响应 Runtime cancel signal 并终止对应子进程；
- 保持最终 `DiagnosticWorker` 返回合同不变。

流式事件不能直接落入 Case。路径只有在符合当前 workspace、完成规范化并按观测 DTO 允许时才能用于唯一文件计数；正文、tool result 和 reasoning 必须在 adapter 边界丢弃。

第一版“按进展停止”发生在 Run/follow-up 边界，不通过短时间 watchdog 强杀仍在活动的单次 Deep 调用。单次调用仅受用户取消和异常进程安全 timeout 约束。

## 设置页

Claude 高级设置拆为两个 profile：

```text
快速排查
  模型路由
  effort
  max turns

深度排查
  模型路由
  effort
  异常进程安全 timeout
```

设置服务负责校验和持久化 profile。Public settings 不暴露凭证。聊天页面不读取这些底层值，只展示三个稳定的产品模式。

现有单一 Claude 配置迁移时：

- 未配置新 profile 的旧配置使用代码默认值；
- 旧 `timeoutMs` 作为 Deep 安全 timeout 的兼容来源；
- `command`、command whitelist、只读 allowed/disallowed tools、session busy retry 保持共享；
- 配置保存不得改写 secret 或放宽只读工具策略。

## 错误、重试与取消

- Fast `error_max_turns`：结构化 partial；手动 Fast 停止，Auto 才能进入一次 Deep。
- Fast profile 模型不可用：返回安全 provider/worker failure，不静默使用未配置模型。
- Deep profile 模型不可用：返回安全错误，不自动降级为 Fast。
- Auto Fast Review 未通过：创建一个新的 Deep Run，不覆盖 Fast Run。
- Auto Deep 失败：不再次 Auto 升级，按现有 Review/Presentation 安全降级。
- 用户取消：只取消当前 Case、当前 user message 对应的 Worker；不得影响其他 Case 或排队回合。
- 服务重启：沿用现有 interrupted/retry 流程，并从用户消息恢复调查偏好。
- Session busy：沿用现有同 Case 串行和有限重试，不因 profile 引入新的并发执行。

## 模块归属

- `web/src/dashboard/`：模式选择器、当前消息一次性状态、脱敏进度和停止按钮。
- `src/gateway/`：请求字段校验、DTO 序列化；不得选择 profile。
- `src/runtime/`：偏好解析、Auto profile resolver、升级门禁、进展比较、事件记录。
- `src/sessions/`：用户消息偏好持久化与重试恢复。
- `src/workers/`：profile-aware worker port 输入与 cancel/stream 能力合同。
- `src/workers/claude/`：CC 参数、stream-json、子进程取消、输出解析、只读策略。
- `src/settings/` 与 `src/config/`：Fast/Deep profile 配置、默认值、校验与 public view。
- `src/observability/`：安全模式/进度事件的展示转换，不决定路由或停止。

## 测试与验收

### 默认离线合同测试

- `/api/chat` 缺少 preference 时默认为 Auto，非法值返回 400；
- 同步/异步聊天传播相同 preference；
- 发送后 UI 选择恢复 Auto；
- 手动 Fast 永不升级，手动 Deep 直接 Deep，Auto 最多升级一次；
- Auto resolver 使用结构化信号而非固定问法关键词；
- 旧 Case 缺失字段可读，新字段 round-trip 正确；
- interrupted retry 保留原消息 preference；
- Fast 命令包含配置的 model、`--effort low`、`--max-turns`、`--prompt-suggestions false`；
- Deep 命令包含配置的 model、`--effort high`、`--prompt-suggestions false`，且没有普通短时 turn cap；
- `error_max_turns` 不触发同档盲目重跑；
- Auto Fast 和 Auto Deep 使用独立 Run；
- cancel 只终止目标 Case 的 Worker；
- stream-json 只产出白名单统计，不持久化正文、reasoning、完整工具参数或完整 provider payload；
- 现有 API response shape、Evidence Review、Presentation 和只读工具策略保持兼容。

默认测试不得联网、花费额度或依赖真实凭证。

### 真实 opt-in 评测

使用 `research-fast-code-investigation` 的 L1/L2/L3 真实问题集，对比现状 CC、Fast、Deep 和 Auto 完整流程。

上线门槛：

- Fast 的 L1 p50 至少比现状降低 40%；
- Fast 确定性 validator 通过率不低于 80%；
- Auto 最终可审核率相对现状下降不超过 5 个百分点；
- Deep 人工质量评分相对现状下降不超过 0.3 分；
- Auto 的 L2/L3 即使首次误判 Fast，也只能增加一次 Fast 成本，最终进入 Deep 或明确 partial；
- Fast `maxTurns` 默认值必须来自评测数据，不得把设计示例值直接固化为永久常量。

真实评测必须显式 opt-in，并记录延迟、turns、token/cost、validator 结果、人工质量和安全失败分类。

## 发布策略

1. 先在 research change 中完成 Fast/Deep 参数 benchmark，确认模型路由和 Fast `maxTurns`。
2. 新建立实施 OpenSpec change，明确 config/case JSON 兼容扩展和 API additive change。
3. 先上线 profile-aware Worker 和离线合同测试，但保持默认行为可通过配置回退。
4. 完成真实 opt-in 验收后启用默认 Auto。
5. 观察 Auto 路由分布、Fast→Deep 升级率、validator 通过率和用户取消率；仅记录安全聚合指标。

## 已确认决策

- 默认模式为 Auto。
- 手动模式只影响当前消息，发送后恢复 Auto。
- Auto Fast 证据不足时最多自动升级一次 Deep。
- 手动 Fast 绝不自动升级。
- 手动 Deep 直接进入 Deep。
- Deep 不使用 3～6 分钟等短时硬超时，按证据进展控制 follow-up。
- 页面提供模式选择，但不向用户暴露底层 CC 参数。
- Runtime 是 profile 选择、升级与停止策略的唯一 owner。
