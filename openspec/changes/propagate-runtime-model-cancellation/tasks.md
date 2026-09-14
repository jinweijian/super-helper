## 1. 输入阶段与回合边界

- [x] 1.1 在 test 新增正式 DiagnosticRuntime + 回环 HTTP 延迟正文失败测试，证明现有 Preflight 停止不能中止模型；记录调用计数和连接收尾，不依赖外部凭证。
- [x] 1.2 在 diagnostic-runtime.ts、preflight-service.ts、answer-goal-completeness-review-service.ts 显式传递可选 signal，阻止取消后嵌套请求及迟到结果；对应失败测试转绿，未传信号的旧消费者兼容。

## 2. 其他模型消费者

- [x] 2.1 在 knowledge-turn.ts、rag-answerability-service.ts 和 case-investigation 编排/query/rerank/analyze/verify 调用中传递回合信号；用阶段测试覆盖请求前取消、请求中取消、吞取消后续调用为零。
- [x] 2.2 在 review-presentation.ts、evidence-coverage-service.ts、answer-coverage-service.ts、visible-prompt-safety.ts 及调用者贯通信号；已冻结结果用确定性表达保留，尚未审核结果不得提升；补取消表达和 Deep 中断保留结果回归。

## 3. 集成与反假完成审计

- [x] 3.1 通过真实 runtime sync/async 入口验证并发 Case 隔离、旧 message 取消不影响新回合、每消息唯一回复、取消后不再调用模型/Worker；正常成功/异常/取消均清理控制对象。保护 HTTP/config/Case JSON shape，不修改 gateway 业务逻辑。
- [x] 3.2 回头重新思考：全仓模型 complete 调用和装配清单对照，排除只加参数未接生产链路、fake 不响应取消导致假绿、catch 吞取消、已接受结果丢失与日志泄漏；补发现反例。明确 MCP/embedding 传输等未覆盖边界，默认验证不联网不花钱。
- [x] 3.3 更新 runtime 文档与总体计划 D2 状态；运行 pnpm test、pnpm test:web、pnpm test:e2e，记录红绿证据、偏差和未验证的真实服务行为，不以 adapter 单测代替入口验收。
