## Why

当前在线排查链路让旧文档知识库、RAG 审核和多个展示 Agent 参与技术判断，导致 CC 已经完成有效代码排查时，程序仍可能把结论降级为“证据不足”。这既增加排查时间，也让模型承担了大量程序可以确定性完成的工作。现在需要把职责收敛为“程序整理输入输出、权威诊断方负责判断”，并为未来替换 CC 建立稳定适配器边界。

## What Changes

- 新增可替换的权威诊断适配器合同，现有 CC 作为第一种实现。
- 将 Runtime 在线主流程收敛为输入整理、上下文准备、权威诊断、结果安全整理和展示。
- **BREAKING** 下线旧文档知识库、BM25、Embedding、Rerank、Knowledge Router 和 RAG Answerability 的在线诊断路径。
- 保留工单 CSV、经验 Markdown、审核、版本和来源追踪，作为未来知识图谱的输入。
- 将 Review 限制为结构、安全、来源和权限检查，不再重新裁决权威方的技术结论。
- 只有权威方明确缺少信息或执行失败时才生成追问或降级回复。
- 下架面向普通用户的旧知识库设置和重建索引入口，保留迁移期离线工具。

## Capabilities

### New Capabilities
- `authority-diagnostic-adapter`: 以统一端口接入 CC、DeepSeek Harness 等权威诊断实现。
- `thin-diagnostic-orchestration`: 由程序整理输入和输出，首轮排查后再根据权威结果追问。

### Modified Capabilities
- `diagnostic-agent-runtime`: 在线答案来源和追问时机改为以权威诊断为中心。
- `deterministic-output-review`: Review 从技术裁决改为安全与结构整理。
- `runtime-behavior-compatibility`: 保持 Case、Run、Evidence 和经验产物兼容，同时移除旧知识库在线行为。

## Impact

- 影响 `src/runtime/`、`src/workers/`、`src/contracts/`、`src/knowledge/experience/`、Dashboard 设置和知识库 API 入口。
- 保留现有 Claude Code 只读权限、取消、超时、重试和脱敏边界。
- 需要新增 Authority Adapter 合同测试、CC 结果保留测试、旧 Knowledge 在线调用为零的回归测试。
- 需要更新部署和迁移文档，说明旧知识库下线、工单经验保留及未来图谱接入方式。
