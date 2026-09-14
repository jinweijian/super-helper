## Why

总体计划 D2 要求停止信号贯通在线模型消费者。当前 provider 已支持 signal，但 runtime 的 Preflight、审核、表达和历史案例模型调用未传入回合信号；停止仍可能等待当前模型超时，影响响应速度与费用控制。

## What Changes

- 将当前回合的取消信号显式传递到 runtime 模型调用，包括嵌套审核调用。
- 阻止取消后新增模型请求及未审核迟到结果进入答案；保留取消前已接受的初步判断。
- 用延迟正文的本地 HTTP 与真实 runtime 入口验证停止，不仅验证 adapter。

## Capabilities

### New Capabilities

- `runtime-model-cancellation`：在线回合模型请求取消、隔离及安全收尾。

### Modified Capabilities

无其他规范替换；延续既有停止入口和 Worker 取消合同。

## Impact

影响 `src/runtime/` 模型消费者及调用者，复用 `src/providers/model/adapter.ts` 可选 signal。保持 HTTP/config/Case JSON 结构兼容，不把运行时信号持久化。

非目标：不部署 Cognee、不切换旧检索、不增加统一任务硬时限、不承诺远端服务停止计费。MCP/Redmine/embedding 的独立传输取消不由本 change 冒充完成，后续并行调度仍需治理全部分支。
