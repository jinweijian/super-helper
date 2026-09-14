## Context

2026-09-10 本地检查：`InvestigationControl.options(caseId)` 已提供回合 signal，`DiagnosticRuntime` 在 Preflight 后检查取消，Worker 已消费该信号。`PreflightService` 及其他 runtime 模型消费者仍仅传 json 等选项。已有 adapter 会中止 fetch/正文读取，但未获得用户信号时只能依赖请求自身超时。

## Goals / Non-Goals

目标：从回合入口到在线模型请求显式贯通取消，禁止取消后的新模型调用、嵌套审核和迟到未经审核结果；维持一次回复和已审核结果保留。

非目标：不改推理深度、任务总时限、模型协议、Agent prompt、CSV 生产或 Cognee；不把本次模型取消当作 MCP/embedding/远端计费取消已完成。

## Decisions

### 所有权与传递

`InvestigationControl` 仍是 controller owner；`DiagnosticRuntime` 在回合开始后取得信号，以可选参数传入阶段方法。阶段向子调用继续传递同一对象，最终传入既有 `AgentModelClient.complete` options。不放到 DiagnosticRequest/Case JSON，不在共享 service 上保存可变 currentSignal，避免并发 Case 串用。相比隐式全局异步上下文，显式参数更易审计遗漏和服务独立测试。

涉及 Preflight/AnswerGoal completeness、Knowledge/RAG answerability、Review/coverage/answer coverage/visible safety/presentation、历史 query/rerank/analyze/verify 及其编排调用者。实际调用清单用全仓 complete 调用检索复核，不仅修改 Preflight。

### 取消与结果边界

模型前检查 signal，返回后再次检查，禁止不响应 signal 的 fake/自定义 provider 的迟到结果被接受。取消不得进入“模型失败后继续调用另一模型”的 fallback；普通 HTTP/解析/缺凭证错误维持安全降级。必要的确定性 evidence 校验和已接受结果渲染可以继续，不开启新模型请求。

不能在所有 catch 中无条件 throw 取消：review/presentation 可能已有 accepted claims，必须先区分已冻结结果与未审核内容。已冻结结果走现有确定性 presenter，并标记初步判断；未冻结结果由 runtime 取消收尾。不得用未审核 worker result 伪装已接受结论，也不得删除此前回合的消息。

Gateway 继续只转发既有取消请求；sessions 不调用模型。正常结束、取消、异常均由现有 finally 清理回合控制；旧 userMessageId 不可取消后续排队回合。

### 外部依赖、失败与兼容

只复用本地既有 AgentModelClient 可选 signal 合同与 adapter，无新增外部 API/凭证/第三方依赖；其完整正文超时证据沿用 A/B 的 model-cancellation 测试，本 change 另验真实 runtime 接线。普通测试只使用合成文本、回环 HTTP 和 fake model，不访问真实业务服务。

缺模型配置、限流、格式错误与超时维持原安全降级；空 evidence 不生成新事实；无新缓存或索引维度。错误不包含原始请求、响应正文或 secret。可选参数保持直接服务消费者兼容，HTTP/config/Case JSON 不变。

## Risks / Trade-offs

- 多层传递遗漏 → 全调用点清单与阶段/入口测试双重验证。
- catch 吞取消又请求 → 取消后调用计数断言，不仅断言最终文字。
- 强制提前返回抹掉有效结果 → Preflight 无结论、Review 已冻结、Deep 中断分开覆盖。
- 自定义 provider 忽略信号 → 至少拒绝迟到结果；不能承诺中断其底层工作。正式 adapter 用本地 HTTP 证明正文读取中止。
- 并行其他非模型分支仍运行 → 记录剩余传输边界，D5 继续治理，不能宣称整条链路立即停止。

## Migration Plan

按 Preflight、证据/历史阶段、审核表达分步接线；无数据迁移，无默认联网变化。撤销本 change 代码可回到既有请求超时行为，保留 A/B adapter 修复。发布前通过完整 pnpm test；涉及停止交互需既有 web/e2e 回归，真实外部模型仅显式 opt-in，不以此阻挡本地可重复验收。

## Open Questions

无阻挡本地实现的用户选择。远端取消计费和生产延迟收益尚未测量，不承诺数值。
