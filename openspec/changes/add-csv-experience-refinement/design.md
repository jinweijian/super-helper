## Context

沿用总体计划 A/B 与经验产物设计，不改写 C—E 的目标。真实 CSV profile 已证明 500 条、41 列、GB18030 可严格解码；原因、处理和计划列都有占位值，106 条仅有最近批注，462 条只有附件引用。原始文件与分析样例不入 Git。

## Goals / Non-Goals

目标：可执行本地导入、AI 提炼、独立审核、来源绑定、不可变 MD/sidecar 发布、暂停恢复与增量处理。非目标：本阶段不切换在线 runtime、不直接连接 Cognee、不迁移旧 Case JSON；这些仍由总体计划后续 change 承担。

## Decisions

### 模块与合同

- `src/knowledge/experience/contracts.ts`、`schema.ts` 定义本地资产结构和校验；`csv/` 只解析、映射与本地 profile；`repository.ts` 等保存受限快照与发布目录。不得调用模型。
- `src/application/experience-refinement/` 组合源记录、模型 port、审核和发布用例。CLI 只解释参数、调用用例和输出安全统计。
- 产品配置仍只放 `src/agents/` 并登记。复用现有 Agent 配置解析入口时，在设计中明确这是配置读取，不把在线回合编排带进批处理；必要时提取中性配置 owner 并保持旧消费者兼容。
- 模型 port 保留既有签名兼容，新增可选 `signal`。计时器覆盖 fetch 和响应体，异常信息不得回显服务端正文或底层带凭证 URL。此 change 修复 adapter，runtime 所有消费者传递取消信号仍由 D2 后续完成。

### 数据流

`experience profile` 只读本地文件，返回字段统计，不输出客户原文。`import` 使用可信 source instance/workspace scope 和明确映射，生成 file SHA256、逻辑记录号、原列名及字段哈希。UTF-8 默认严格解析，其他编码显式指定；成熟 `csv-parse` 支持引号/多行和配置分隔符，不按行 split。重复表头、结构错位拒绝整批，缺 ID 或重复 ID 隔离相关记录。

首批映射：`#`→ticketId，`项目`→sourceProject，`主题`→title，`描述`→description，`工单问题原因`→cause，`问题处理方法与结果`→actionAndResult，`后续计划`→followUp，`最近批注`→latestNote，`目标版本`→targetVersion。`所属产品`/`网校版本` 为空即未知；附件和相关问题仅作覆盖元信息，不读取外链。

原快照保存在 `<root>/private`；Obsidian 仅打开 `<root>/vault`。可信范围不从正文推断。正式身份使用 source instance、workspace scope、project、ticket ID 生成，内容变化产生 source revision；同内容跳过，旧更新时间不能覆盖较新版本。部分导出缺行不表示删除。

### 提炼与审核

源字段先清理已知身份字段、凭证行、客户地址等，保留脱敏记录。正文指令视为不可信数据。提炼输入只有可用业务字段，不含人员列。提炼输出结构化 claims、步骤、未知和证据别名；独立审核仅接收同一脱敏源与待审对象。确定性校验验证来源存在、片段确实匹配、步骤执行状态、等级约束和正文/sidecar 一致性。

审核失败最多一次内容修订；仍失败隔离，不反复改到通过。模型请求异常与审核失败分开记录，瞬态重试计入调用预算，检查取消。工单关闭不证明验证，措施有效不证明根因；允许 `source_reported`、`lead_only` 发布有边界的可用子集。敏感内容或不可定位来源不得发布。

### 发布与恢复

MD 与 sidecar 从同一个审核通过对象渲染。写入不可变修订目录后，以原子清单切换作为发布提交点；崩溃留下未引用文件不成为已发布知识。发布内容 hash 在清单中，不自引用。编辑 MD 导致 hash 不匹配时拒绝作为发布知识返回。checkpoint 逐记录原子写入，批次锁避免并行覆盖。取消保留已完成记录，恢复只处理未完成项；批次记录模型/配置/schema 版本、调用量和失败原因，不存隐藏推理。

元数据以独立审核覆盖的 attribute claims 生成，不从未经审核字段另行拼装。sourceRevision 先规范化源 schema，再按固定字段序列计算，避免属性排列和输入空白导致伪修订。渲染同时校验 draftHash/sourceRevision，来源变更后旧审核无效。隐私终检覆盖带引号及序列化转义引号的 JSON/YAML 凭证；这不替代源脱敏与独立隐私审核。

## Risks / Trade-offs

- 自动脱敏无法仅靠正则证明全部匿名化 → 明确禁止身份列进入模型，增加终检和敏感样例，剩余不确定材料隔离；真实模型调用前明确发送范围。
- 长批注超过模型上下文 → 不静默截断；报告超限并隔离/按证据块受控处理，保留完整源快照。
- 两模型一致不代表真实验证 → evidence grade 来自源验证材料，不来自模型置信度。
- 网络限流、超时、格式错误 → 安全错误分类、有界请求、checkpoint；默认测试 fake，真实服务显式启动。
- 文件路径/符号链接越界 → 根目录校验、内部文件名使用规范 hash、安全权限和路径测试；CLI 不允许把资料默认写入代码仓库。
- 旧时间、乱序导出、重复 ID → 隔离冲突，保留既有安全修订，不按导入顺序提升权威。
- 费用统计缺少实际 usage → 调用量与 token/费用未知显式区分，不能用调用次数冒充账单金额。

## Migration Plan

新增 opt-in CLI，不改旧命令、配置、HTTP 或 Case JSON。先合成 fixture 闭环，再本地真实 CSV 导入，最后明确预算后真实模型小批量，扩大到 500 条。回退停止使用新命令即可，原始数据与旧服务保留。

## Dependencies and acceptance

- CSV parser 官方来源：https://csv.js.org/parse/options/ 。2026-09-09 确认可访问，安装时固定实际解析器版本并验证 BOM、columns、delimiter、relax_column_count 与多行行为。
- Node AbortController 为运行环境现有接口；不新增模型 HTTP 协议，复用当前 OpenAI-compatible adapter，以本地 HTTP server 测试响应体卡住与取消。
- 必须通过 `pnpm test`，真实 CSV 本地 profile/import 不联网；真实模型验收显式 opt-in。记录逐项命令、结果、偏差、未验证项。
- UI 不在此 change 范围；后续 C—E 仍需真实 Cognee、在线 UI 与整体排查效果验收。

## Open Questions

首次生产导入的可信 scope/source instance、真实模型与批次费用上限需显式设置。导出是否完整未确认，不阻挡部分导入。未配置真实服务前仍可完成离线产品闭环，不能宣布全部真实验收完成。
