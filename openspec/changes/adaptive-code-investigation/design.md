## Context

权威产品设计：[自适应代码排查模式](../../../docs/superpowers/specs/2026-08-20-adaptive-code-investigation-modes-design.md)。当前 baseline 1ec68d6。

## Goals / Non-Goals

交付模式选择、偏好重试、profiles、一次升级、脱敏进度和真实取消；不替换 CC，不宣称未经真实 benchmark 证明的加速比例。

## Decisions

- contracts/investigation.ts 定义 InvestigationPreference、InvestigationExecution、InvestigationProgress。CaseMessage 可选 investigationPreference，DiagnosticRequest 可选 investigation。旧字段缺失为 auto。
- config.claude.investigationProfiles 可选，包含 enabled、fast {model, effort, maxTurns}、deep {model, effort, timeoutMs}。未启用时沿用旧 Worker 行为；启用必须提供校准后的配置，禁止凭空固化 Fast 默认 turns。
- Worker port 增加可选第二参数 {signal,onProgress}，不影响既有 adapter。Runtime 管理当前 Case/message 的 AbortController 和安全进度快照，Gateway 只暴露 GET /api/chat/progress 与 POST /api/chat/cancel。
- Runtime 从当前消息恢复偏好，在 Worker dispatch 前选择 profile。历史核验默认 Deep 且保留单 Worker/Review；手动 Fast 优先于自动历史路由。无 profile 时兼容旧路径。
- Auto Fast 经 Review 后不充分时一次 Deep；手动 Fast 没有 follow-up；Deep follow-up 需要可核验的新证据进展。所有 request 保持 AnswerGoal，Run 单独记录。
- 新逻辑放入独立模块；现有大入口仅增加窄委托。Gateway 不依赖 CC；Worker 不负责 Review；原始事件只在 adapter 内解析，不进入 Case。
- CLI 协议来源为 https://code.claude.com/docs/en/cli-reference ，本会话此前已核验本机 2.1.218 支持 effort/max-turns；实施再次检查本机 help。stream-json 需 --verbose。凭证沿用运行环境，不读取或持久化密钥。

## Risks / Trade-offs

- 未完成真实校准 → profiles 默认关闭，管理员配置后启用；保留显式 opt-in 发布闸门。
- malformed stream、provider 错误、限流、缺权限 → 安全 partial，禁止静默切换模型。
- 用户取消与回合排队 → 仅匹配当前 message 的控制器可以取消，不能取消其他 Case 或排队消息；取消在 Runtime 收尾保留可重试 interruption。
- 子进程不响应 SIGTERM → 有界宽限后 SIGKILL，清理监听器与定时器。
- 旧缓存/Case → 可选字段读取缺省，不批量迁移；round-trip 和 retry 测试。
- 安全进度仅白名单计数与阶段，路径在 workspace 规范化后仅用于去重，不对外返回。

## Migration Plan

离线测试和构建通过后交付功能分支；真实 L1/L2/L3 opt-in benchmark 沿用 research change 门槛，未通过前不默认启用 profiles。删除新可选配置即可回退旧 Worker 行为。
