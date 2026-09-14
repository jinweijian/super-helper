## Context

当前 Runtime 同时编排 Experience、旧 Knowledge/RAG、MCP、Redmine、CC Worker、多个 Review Agent 和 Presentation Agent。Knowledge/RAG 会在 CC 前产生候选，Review 又可能覆盖 CC 已完成的技术判断。`ai-graph` 的实践表明，模型应承担语义判断，程序应承担边界、输入输出、状态和账本。

## Goals / Non-Goals

**Goals:**

- 以统一 Authority Diagnostic Port 接入 CC，并允许未来替换为 DeepSeek Harness。
- 让首轮诊断直接进入权威诊断方，程序只准备上下文和整理结果。
- 下线旧知识库在线路径，保留工单经验和未来图谱接口。
- 保留只读、安全、取消、超时、重试、审计和 Case 兼容能力。

**Non-Goals:**

- 本变更不实现 Cognee 图谱构建或实体关系抽取。
- 本变更不删除工单经验 CSV/Markdown 产物。
- 本变更不改变公开 Case/Run JSON 结构。

## Decisions

### 1. Authority 采用端口与适配器

在 `src/contracts/` 定义稳定的权威诊断输入输出合同；CC adapter 负责现有 CLI、session、只读工具和解析。Runtime 只依赖端口。选择端口而不是在 Runtime 增加 provider 分支，是为了让 DeepSeek Harness 替换不影响 UI、Case 和经验数据。

### 2. 在线 Runtime 移除旧 Knowledge 来源

普通诊断和历史案例并行收集不再调用 KnowledgeTurnService。旧知识库保留为离线迁移工具，避免误把已有索引当作当前项目事实。工单经验由 Experience 独立提供参考上下文。

### 3. Review 只检查边界

Review 保留结构、引用、workspace、敏感信息和操作安全检查；不依据关键词、RAG 覆盖或内部评分重新裁决权威技术结论。无法安全验证的单条内容局部剔除，不能清空整个有效结果。

### 4. 追问由权威结果触发

首轮只因空问题或缺失 workspace 阻断。后续追问必须来自 authority result 的 unknown/missingInfo，并说明获取位置和继续动作。

## Risks / Trade-offs

- [权威方返回格式不稳定] → adapter 做结构解析和安全降级，增加 fake adapter 合同测试。
- [旧 Knowledge 依赖未完全清除] → 增加在线调用为零的架构测试，前端停止调用旧 API。
- [权威结论可能包含未经证实的判断] → 保留 fact/inference/unknown 类型和来源，不在程序层擅自升级。
- [未来图谱结果污染诊断] → 图谱 provider 只输出输入上下文，禁止直接生成用户回复。

## Migration Plan

先接入 Authority Adapter 并保留现有 Worker 兼容端口；再切断旧 Knowledge 在线调用；随后收敛 Review/Presentation；最后下架设置和 API UI 入口。旧索引和离线命令在迁移期保留，出现问题可通过配置回退读取，但不恢复为默认在线来源。
