---
name: refine-ticket-csv
description: 在 super-helper 中处理 Redmine 导出 CSV、增量沉淀工单经验，或检查与恢复经验提炼批次时使用。普通在线工单诊断不使用此技能。
---

# 从工单 CSV 沉淀经验

目标是可追溯、可复用的经验，不是让每一行都变成知识。使用项目已有 CLI，不另写 CSV 解析器或让临时模型直接生成发布文件。

## 权威入口

先确认当前工作目录是 super-helper，阅读[当前命令及验收边界](../../../docs/architecture/experience-production.md)。命令示例里的路径和身份必须替换为本次明确的输入，不照搬示例身份。

- 操作流程：`src/cli/command-experience.ts` 与 `src/application/experience-refinement/`。
- 产物结构与等级：`src/knowledge/experience/schema.ts`、`artifact-validation.ts`、`artifact.ts`。
- 产品提炼/审核行为：`src/agents/experience-refiner.md`、`experience-reviewer.md` 和 `registry.json`。本 Skill 不复制这些 prompt。

只有源码变更或 dist 缺失/过期时才按项目要求构建，不为每一条工单重复构建。

## 按当前请求选择操作

### 检查或首次导入

1. 对指定 CSV 运行 `experience profile --file <绝对路径>`。默认严格 UTF-8；已确认其他编码才显式传 `--encoding`。检查列映射、占位值、重复身份、日期和缺失信息；非空率不是可发布率。
2. 若用户只要求分析，交付统计和缺口，不导入或发送给模型。若已授权本地导入，确认可信 scope、source-instance、项目列/回退项目，以及仓库外私有 store。缺少这些信息时集中询问，不从客户正文推断。
3. 运行 `experience import`。需要自定义列名时用 `--mapping` JSON 对象，保留原 CSV，不在源码仓库保存业务原文。附件引用不代表已获取附件，最近批注不代表完整历史；不要自行访问 Redmine 或外链补齐。

### 提炼与发布

开始前确认用户已授权将脱敏业务字段发送给指定模型，明确配置文件、job ID 和最大调用数。仅授权本地导入、已有模型密钥或“尽快完成”都不自动提供发送授权。

运行现有 `experience refine ... --enable-model true --max-calls N`。该命令会自动提炼、独立审核并发布通过终检的子集，无需逐条让用户审批；不支持部分会隔离或降级。原始 private 快照不直接送模型，不把模型一致认可当作真实修复验证。

固定 job 绑定源集合和配置；恢复使用原 job。源集合有增量时可建立经授权的新批次，已发布源修订由系统复用；不得为了绕过耗尽预算创建新 job。需要提高预算或重做已终结材料时，先说明现有工具是否支持，再请求明确处理决定，不编辑 job.json。

当前 CLI 不支持为既有 job 提高调用上限，修改 `--max-calls` 会配置不匹配。也没有专门的“禁用模型、仅完成发布”入口；没有发送授权时，不以可能命中检查点为理由运行启用了模型的 refine 命令。报告这一限制，不臆造参数。

### 查询、取消与恢复

- 导入状态用 `status --batch`；提炼状态用 `status --job`，二者互斥且不调用模型。
- Ctrl-C/取消保留已保存阶段。请求已发送但结果未保存时可能重复请求，预留调用量不会退回，不承诺外部调用 exactly-once。
- 遇到 busy，先核实持有进程。只有明确要求恢复且工具确认同主机进程已退出，才运行 `recover --lock writer|runner --confirm true`。未知归属、旧格式、活进程或 recovery guard 异常停下报告，不手动删锁。
- 清单缺失/损坏、源版本冲突或哈希不匹配时，保留已有资产，报告具体安全错误；不通过清空仓库、删除清单或重建空库消除错误。

## 交付什么

简洁报告输入范围、处理数量、隔离/失败数、调用预留与余额、产物位置和未验证项。状态中的 published 是该任务记录过的数量，不是当前仍有效经验数量；锁存在也不证明任务正在运行。

Obsidian 只打开 store 下的 vault，不打开 private。图谱接入消费通过发布清单和哈希检查的经验，不扫描所有 MD 判断正式知识；尚未完成 Cognee 接线时明确说明，不虚构图谱已生成。原始 CSV、私有检查点和未发布草稿都不是正式检索知识。
