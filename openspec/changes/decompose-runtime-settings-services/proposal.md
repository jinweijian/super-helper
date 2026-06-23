## Why

前两阶段已经清理 provider、retrieval、knowledge 与 CLI 边界，但 `src/runtime/diagnostic-runtime.ts` 仍以 696 行同时处理队列、会话生命周期、Preflight、经验复用、知识诊断、worker retry、Evidence Review、展示和 solved-case 策展；`src/settings/service.ts` 也以 374 行混合输入 contract、公开视图、secret、模型、provider 和 Claude 设置。继续在这两个文件增加逻辑会让模块边界重新坍缩。

本 change 将这些职责拆为可独立测试的协作者，同时保留现有构造函数、公开方法、HTTP DTO、case JSON、日志 phase 和用户可见行为。

## What Changes

- 将同 case 串行队列与 session lifecycle 从 `DiagnosticRuntime` 提取为独立协作者。
- 将 Preflight、experience、knowledge turn、worker retry、review/presentation 和 case curation 提取为 focused runtime services。
- 将 `DiagnosticRuntime` 收敛为不超过 300 行的组合根，保留原构造函数和五个公开方法。
- 禁止 runtime 组合根直接处理 knowledge 路径、索引 artifact 或 provider 创建。
- 将 settings 拆为 contracts、public view、secret application、model settings、embedding/rerank provider settings 和 Claude settings。
- 将 `settings/service.ts` 收敛为薄兼容 re-export facade，gateway route 与导出签名保持不变。
- 增加结构边界、真实委托、同 case 串行、sync/async 共管线、日志 phase 和 settings HTTP 兼容测试。

## Capabilities

### New Capabilities

- `runtime-service-decomposition`: 约束 runtime 组合根与 turn/session/preflight/experience/knowledge/worker/review/curation 协作者的所有权。
- `runtime-behavior-compatibility`: 约束同 case 串行、Deep Query retry、Evidence Review、日志 phase 和公开 Runtime API 兼容。
- `settings-service-decomposition`: 约束 settings contracts、公开视图、secret 与各设置能力的拆分及 HTTP 兼容。

### Modified Capabilities

- 无。本 change 只调整内部所有权，不改变产品需求或公共数据结构。

## Impact

- 主要影响 `src/runtime/`、`src/settings/`、`test/module-boundaries.test.mjs` 和现有 runtime/settings 集成测试。
- 不改变 `DiagnosticRuntime` 构造参数、公开方法、`AgentResponse`、HTTP response、CLI、config、case JSON 或 knowledge artifact schema。
- 默认测试继续使用 fake/fixture，不联网、不使用真实凭证。
