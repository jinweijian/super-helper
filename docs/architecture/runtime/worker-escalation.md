# Worker 升级

## 读者先看

当历史经验和知识库不能完整回答 `AnswerGoal` 时，Runtime 才升级只读 Worker。Worker 是工具，不是产品 Agent；它返回结构化结果，不能直接回复用户。

可执行修复必须作为 `role=next_action` claim，绑定相关 evidence ID 和当前精确
must-answer item，并声明 worker-only `actionSafety` 与 `executionStatus=proposed`。写配置、部署、
删除或覆盖等变更只能标记 `requires_authorization`，不能声称已执行；parser 会丢弃缺少该结构的 action。

当前默认 Worker adapter 是 Claude Code Worker。

## 功能边界

| 负责 | 不负责 |
| --- | --- |
| 构造 `DiagnosticRequest` | 解析 HTTP DTO |
| 附加 case context、knowledge context、deep query context | 选择最终用户结论 |
| 调用 `DiagnosticWorker` port | 修改 workspace |
| 解析 Worker failure 为结构化结果 | 持久化长期记忆 |
| bounded follow-up / Deep Query Retry | 绕过 Review |

## 输入与输出

| 输入 | 输出 |
| --- | --- |
| `DiagnosticRequest` | `DiagnosticResult` |
| allowed MCP tool IDs | `WorkerTrace` |
| workspace path | follow-up request（必要时） |
| knowledge partial context | Review 可消费的 claims/evidence |

## 正常流程

```text
buildDiagnosticRequest
  -> attach context
  -> DiagnosticWorker.diagnose
  -> parse output / failure
  -> optional follow-up DiagnosticRequest
  -> Review
```

## 失败/降级

| 场景 | 行为 |
| --- | --- |
| Claude CLI 输出无法解析 | 转为 partial/need_input 结构化结果 |
| reused session busy | adapter 做有限重试 |
| 第一轮证据不足但可继续 | Runtime 生成 follow-up request |
| 达到 retry 停止条件 | 当前 partial 进入 Review，不无限循环 |
| Worker 没有 usable evidence | Presentation 只展示安全失败类别、状态、下一步和 case/run |

## 代码入口

- `src/runtime/request-builder.ts`
- `src/runtime/worker-diagnosis.ts`
- `src/runtime/worker-turn.ts`
- `src/runtime/deep-query-planner.ts`
- `src/workers/diagnostic-worker.ts`
- `src/workers/claude/claude-code-worker.ts`
- `src/workers/claude/claude-prompts.ts`
- `src/workers/claude/claude-policy.ts`
- `src/workers/claude/claude-cli.ts`
- `src/workers/claude/claude-output-parser.ts`

## 不负责什么

- 不生成用户最终回复。
- 不把 Worker stdout/stderr 直接暴露给主聊天。
- 不请求默认写操作。
- 不读取另一个 case、tenant、user 或 workspace 的上下文。
# 自适应排查模式

消息可携带 investigationPreference（auto/fast/deep），旧消息缺省 auto。启用 claude.investigationProfiles 后，Runtime 在完成已有来源收集后，使用结构化候选、冲突和历史核验信号选择 profile。手动快速不升级；自动快速审核不足最多追加一次独立 Deep Run。每个 Run 保持同一 AnswerGoal，结果继续经过 Evidence Review。

profiles 默认未启用。管理员在设置中填写校准后的模型路由、Fast maxTurns 与 Deep 异常进程 timeout 后开启；关闭即可恢复旧 Worker 参数。Deep 不设普通短 turn 上限，后续追查必须有新的审核证据进展。尚未完成真实 L1/L2/L3 benchmark 时不得声称具体加速比例。

Runtime 的 InvestigationControl 按 caseId/userMessageId 持有当前回合控制器。GET /api/chat/progress 返回白名单进度；POST /api/chat/cancel 仅取消匹配的活动回合。导航停止本地轮询不会取消后台任务。取消后没有已审核判断时持久化 user_cancelled 中断，retry 读取原用户消息偏好。

Worker port 的可选 options 接收 signal/onProgress。Claude adapter 使用 stream-json 解析 Deep 工具活动；原始事件和模型正文不进入 trace/日志，公开数据仅阶段、计数和活动时间。POSIX 下每次子进程有独立进程组，取消先 TERM、宽限后 KILL 整组。
