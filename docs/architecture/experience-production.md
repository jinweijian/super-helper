# CSV 经验生产

本模块将离线工单材料转成可追溯经验，和在线诊断分开。当前已接通 profile、本地 import、导入批次 status、显式启用的 refine 命令、阶段检查点、原子发布和受控锁恢复。真实模型质量、磁盘断电恢复和 Cognee/在线 pipeline 尚未验收。

## 已可运行的检查

```sh
pnpm build
node dist/cli.js experience profile --file /absolute/path/issues.csv --encoding gb18030
```

默认 UTF-8 严格解码；GB18030 必须显式指定。可用 `--delimiter comma|semicolon|tab`。命令不加载模型配置、不访问工单 API、不写入源文件，输出数量、字段覆盖、占位值、日期失败、重复身份及未映射列，不输出单元格正文。占位值统计不等于可发布率。

当前映射冲突会安全失败；import 支持 `--mapping /absolute/path/mapping.json`，格式为字段别名到导出列名的 JSON 对象，例如 `{"ticketId":"单号","title":"摘要","cause":"原因说明"}`。映射文件严格 UTF-8、最多 64 KiB，只允许已定义字段；未覆盖字段继续使用标准别名，不存在列和重复映射拒绝导入。空身份、重复 ID 是 profile 诊断信息，不能据此直接发布。profile 不证明附件和评论历史完整。

## 本地导入与批次查询

```sh
node dist/cli.js experience import --file /absolute/path/issues.csv --encoding gb18030 --store /absolute/private/experience-store --scope local-pilot --source-instance redmine-export
node dist/cli.js experience status --store /absolute/private/experience-store --scope local-pilot --source-instance redmine-export --batch <import返回的batchId>
```

scope 和来源实例必须由调用者明确提供，不从正文推断。导出没有项目列时可显式提供 `--source-project`。store 必须在当前项目之外，使用私有空目录或已经匹配相同 scope/来源实例的知识库；目录权限 0700、文件权限 0600，不接受符号链接目录。原始 CSV 按文件哈希保存在私有 sources，脱敏规范化源保存在 records；两者都不对模型自动可见。

重复源修订跳过；旧导出、同时间不同内容或无法判断先后顺序的修订隔离，不覆盖已接受源。批次状态与逐行结果一起保存，包括隔离原因、来源修订及历史/附件缺失提示；CLI 只输出数量和批次标识，不回显正文。SIGINT/SIGTERM 在记录间停止，再导入同一文件可复用已保存的记录。当前 status 的计数表示最近一次执行结果，不是累计新增量。

异常进程退出后遗留的 writer.lock 会安全拒绝继续写入；确认同主机记录 PID 已不存在后，可用显式 recover 重命名保留旧锁证据，再使用原任务续跑。不会自动猜测或删除遗留锁。正则脱敏也不代替独立隐私审核，当前真实 CSV 仅完成 profile 验收。

## 模块边界

- `src/cli/command-experience.ts`：参数解释和安全 JSON 输出。
- `src/application/experience-refinement/profile.ts`：只读检查用例。
- `src/application/experience-refinement/import.ts`：本地导入与批次查询用例。
- `src/knowledge/experience/batch-repository.ts` / `store-files.ts`：私有源快照、版本指针、逐行审计与本地检查点，不负责模型或发布决策。
- `src/knowledge/experience/csv/`：成熟 CSV parser、读取、映射与统计；固定依赖 `csv-parse@7.0.2`。
- `src/knowledge/experience/schema.ts` / `contracts.ts`：结构化源、草稿、审核与产物契约。
- `src/knowledge/experience/provenance.ts`：可信 scope/来源实例/项目/工单身份以及源修订哈希。
- `src/knowledge/experience/artifact-validation.ts` / `artifact.ts`：来源片段、审核版本和内容检查，同源渲染 MD 与 sidecar；它们不调用模型、不执行实际持久化发布。

产物渲染只接受审核为 accepted 且绑定同一 sourceRevision/draftHash 的对象。Markdown 中的 published 表示已通过渲染前门禁的候选发布内容；只有发布仓库原子清单提交后才对查询可见，不能直接扫描目录当作正式知识。独立审核结果由应用用例生成并保存，发布时重新校验。

元数据通过已审核的 attribute claims 生成；受影响版本不能引用目标版本列替代。缺少验证 claim 的材料不能标为 source_verified。正则隐私筛查只是一道检查，不代表已经证明匿名化；真实发布仍需独立 AI 隐私审核和脱敏源流程。

## 单条提炼与独立审核

`src/application/experience-refinement/refine-record.ts` 提供单条用例：脱敏源最小投影 → 注册提炼 Agent → 独立消息上下文审核 → 确定性终检。配置读取复用 `runtime/agent-configs.ts`，不启动在线 runtime。provider 通过既有 model port 注入，CLI 由 configured-run 用例组合配置和 SecretRef 读取。

模型只接收业务字段 value/completeness 与不透明源修订，不接收 scope、项目身份、工单 ID、原列名或原始字段哈希。输入超过 120,000 UTF-8 字节时隔离，不截断；这是单条模型输入保护，不是在线复杂任务的固定超时。源先过机械隐私检查，真实发送仍需明确 opt-in。

审核上下文没有生成聊天；修订最多一次，带回原草稿和结构化审核供最小修复，重新独立审核后才可 accepted。accepted 仅表示单条审定对象，不等于持久化发布。每次调用消耗共享调用预算，取消或预算耗尽返回 paused，未知 provider 异常只返回安全类别。瞬态请求错误最多额外重试两次，使用可取消退避；审核重试不重新生成草稿，认证失败不重试。批次用例已经持久化调用预留与阶段 checkpoint。

离线 fake model 用例验证上下文边界、拒绝伪造引用和缺失附件、驳回未实施措施后降级、修订上限与取消；不证明真实模型能识别所有语义错误或提示注入。

## 本地发布仓库

`publication-repository.ts` 提供 publish/list/withdraw，publish 已接入批次 refine；list/withdraw 暂为内部接口。发布再次验证审定对象及当前导入源，将 MD 和 sidecar 保存到 vault 不可变对象目录，完整审核记录留在 private；只有原子发布清单提交后才被 list 返回。

读取同时复核内容哈希、sidecar 哈希、审核记录哈希，并从审核记录重新渲染比较。相同源与草稿幂等；撤回经验不返回，也不被重复发布自动复活。孤立文件即使内容完整也不是已发布知识，后续 Cognee 必须通过该查询边界消费，不能扫描 vault 判断发布状态。真实子进程已覆盖清单提交前后退出和锁恢复；这仍不等于磁盘断电或真实业务全链路验收。

## 完整交付跟踪

批次应用 `refine-batch.ts` 已组合导入源、单条提炼、审定检查点和发布。`RefinementJob` 在 private 下记录固定源集合、模型配置指纹、Agent 配置指纹、调用上限和已消耗调用量；每次实际请求前先保存预留。相同 job ID 的配置或源集合变化拒绝继续，不默默增加额度。已发布/隔离/失败记录跳过，已审定待发布记录不重复调用模型。

结构化草稿、审核结果和内容修订次数已逐阶段保存并绑定源修订。恢复时可跳过已保存阶段，已完成审核可在零调用余额下继续终检与发布。请求响应返回但检查点尚未提交的窗口仍可能重复请求，已预留预算不会退回。已通过真实子进程在发布清单提交前后退出及显式锁恢复测试，但未验证磁盘断电，也未完成真实业务全链路验收。不得自动删除遗留 runner.lock 或借用新 job ID 绕过预算。

## 显式模型提炼命令

遗留锁可显式执行 `experience recover --store <目录> --scope <范围> --source-instance <实例> --lock writer|runner --confirm true`。仅同主机且 PID 探测明确返回不存在时恢复；存活、PID 重用、权限不明、旧格式或初始化不完整均拒绝。恢复是重命名保留旧锁目录，不删除材料；命令不启动任务，之后仍需使用原 job 续跑。恢复操作本身意外中断遗留的 recovery guard 仍需人工检查，不递归自动清锁。

```sh
node dist/cli.js experience refine --store /absolute/private/experience-store --scope local-pilot --source-instance redmine-export --job pilot-1 --config /absolute/path/config.json --max-calls 20 --enable-model true
```

此命令将已导入且未隔离的业务字段发送给配置中的活动模型，并发布通过审核的经验。必须事先确认发送范围；`--enable-model true` 和正整数调用上限必填，不接受通过默认配置偷偷启用。模型参数沿用指定配置，SecretRef 从其 storage.rootDir 读取；命令不回显密钥、配置正文或工单正文。同 job 重跑不重置预算。

`experience status --store <目录> --scope <范围> --source-instance <实例> --job <任务ID>` 只读查询提炼任务，不加载模型配置。返回调用预留/余额与持久化终态数量；published 表示任务记录过的发布数，不是当前未撤回经验数。执行活性返回 unknown，不能从锁文件推断进程存活。`--job` 与查询导入批次的 `--batch` 互斥；当前不推断未记录条目总数或百分比。

完成返回统计 JSON；暂停或存在模型失败时退出码为 2，参数/仓库异常非零。默认回归使用回环 HTTP 模拟服务，不访问外部模型。

- [实施合同](../../openspec/changes/add-csv-experience-refinement/tasks.md)
- [实施证据](../../openspec/changes/add-csv-experience-refinement/implementation-notes.md)
- [总体计划](../superpowers/plans/2026-09-07-csv-experience-and-runtime-plan.md)

默认测试使用合成材料与本地 HTTP server，不发送真实工单给外部服务。真实模型、Cognee 和在线效果验收分别记录。
