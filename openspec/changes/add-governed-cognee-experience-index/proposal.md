## Why

CSV 经验生产已形成离线发布合同，但在线排查尚不能检索这些经过审核的经验。需要将正式 MD 作为权威，Cognee 作为可重建候选索引，在进入 Runtime 前完成来源回读、版本和撤回校验。

## What Changes

- 验证固定 Cognee v1.5.4 的隔离实验与真实协议，先使用合成经验。
- 建立中性索引 port、Cognee provider、generation 发布用例和经验 retrieval/evidence pack。
- 仅索引本地 published 产物；远端候选必须绑定本地当前修订，缺来源、越权或撤回项不得成为证据。
- 提供默认不联网的测试与显式 opt-in 实验入口，保存导入/构图/查询/更新/撤回/重建证据。

## Capabilities

### New Capabilities

- `governed-experience-index`：已发布经验的派生图索引、修订治理与来源绑定检索。

### Modified Capabilities

无既有在线路径替换。本 change 交付新能力，D5/E 后续接入与切换，不悄悄恢复旧文档索引。

## Impact

新增 contracts、providers/experience-index、application 索引用例及 retrieval/experience。实验代码位于本 change 的 spikes；知识私有数据与 Python 环境在仓库外，不提交。

非目标：不修改 Case JSON、HTTP response shape，不使用 Cognee 生成用户终稿，不重新比较所有图产品，不将企业资料默认发送至模型服务。旧 graph-assisted 调研不标记完成；总体计划 C—E 保持原目标。
