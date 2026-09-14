## Why

首批 Redmine CSV 已到达并完成本地检查：500 条、41 列，真实原因与处理结果可以脱离在线 API 获取，但占位文本、未执行计划、附件缺失和敏感信息不能直接入库。需要从一次性样例推进到可恢复、可追溯的经验生产流程。

## What Changes

- 建立 `experience/v1` 经验与证据契约、同源 Markdown/claim sidecar 渲染和不可变发布修订。
- 提供 CSV profile/import/refine/status 命令，保存受限快照、显式字段映射、增量 checkpoint。
- 通过注册的提炼 Agent、独立上下文审核 Agent 和确定性门禁自动发布、降级或隔离，不要求逐条人工审核。
- 模型请求支持调用方取消与完整响应体超时，批处理显式启动并限制调用预算。
- 提供操作 Skill、离线合成验收与真实 CSV 本地验收记录。

## Capabilities

### New Capabilities

- `csv-experience-refinement`：离线 CSV 到来源可追溯经验的生产与治理。

### Modified Capabilities

无既有规范行为替换；模型调用新增可选取消信号，保持原调用兼容。

## Impact

新增 `src/knowledge/experience/`、`src/application/experience-refinement/`、`src/cli/command-experience.ts`、产品 Agent 和测试；必要调整 model adapter。CLI 解析和输出不承载提炼策略，知识存储不调用模型。

非目标：本 change 不部署 Cognee、不切换在线诊断、不删除旧 RAG/Case 数据。这些仍按总体计划 C—E 后续交付，不能因本 change 完成宣布总体目标完成。真实模型调用仅显式 opt-in，默认测试不联网。原始业务资料不进入源码仓库。
