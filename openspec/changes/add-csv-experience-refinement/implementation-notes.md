# 实施证据

## 基线

2026-09-09，用户明确选择当前目录实施并保留已有改动。未创建 worktree、未提交或推送。基线 `pnpm test` 退出 0，597 测试通过，包含 docs lint、typecheck 和 build。

首批 CSV 只读 profile 已完成；原件和样例在 Downloads，不在仓库。本 change 尚未实现全部能力，C—E 仍属于总体目标。

## 任务证据

后续逐项追加：任务、失败侧证据、成功侧命令、真实验收边界、偏差和未验证项。

### 2026-09-10 输入、产物基础与模型取消

- 1.1 完成。固定 `csv-parse@7.0.2`，解析/映射/profile 位于 knowledge；application 组合，CLI 已接通 profile。多行、GB18030、错误编码、重复表头、错位、占位值、日期与重复身份测试通过。初始新增模块测试为缺少实现失败；正式 CLI 回归先因 Unknown command 失败，再通过，未把缺模块误称为既有业务缺陷。
- 真实本地命令：`node dist/cli.js experience profile --file /Users/king/Downloads/issues.csv --encoding gb18030` 退出 0；500 条/41 列、无重复或缺身份、500 条多行。字段映射与既有独立本地分析一致。源文件 SHA256 为 `8c721a15f1842303731465e43068db0fc86f0333033bb08cb794c64ac1ab6152`。未调用模型/Redmine/Cognee，未把正文写入项目。
- 1.2 部分完成：新增 schema、来源身份/修订、审定对象验证、同源 MD/sidecar 渲染。review 绑定 draftHash 与 sourceRevision，元数据来自 reviewed attribute claims；目标版本不得充当受影响/已修复版本。尚需对接实际审核/发布库和完整生命周期，保持任务未勾选。
- 2.1 完成：适配器支持可选 signal，计时器覆盖响应体；安全 ModelRequestError 分类、白名单 networkCode。独立子任务先复现5个失败（正文超时、预取消、读取中取消、监听器清理、HTTP正文泄漏），最终9个局部测试通过。既有超时测试通过。全量首次发现旧原文网络错误断言冲突，保留安全 code 的诊断价值并更新精确兼容测试，不恢复原文回显。
- 独立审查复现 sourceRevision 依赖属性排列、JSON带引号凭证漏检两项 P2，补反例失败后修复；进一步对 FIFO 用真实临时管道复现读取阻塞，改非阻塞打开并拒绝非普通文件。局部回归证明修复。
- 最后局部命令：`pnpm exec tsc -p tsconfig.build.json && node --test test/experience-csv.test.mjs test/experience-artifact.test.mjs test/model-cancellation.test.mjs`，29/29 通过；既有 allowlisted fetch cause 测试 1/1 通过。
- 3.1 仅 profile 已接线，import/refine/status 未完成。3.3 仅 profile 验收，尚未使用真实源导入/真实模型。
- 复核追加：Markdown 转义导致精确 `[已脱敏]` 占位符被误隔离，已用完整 renderer 测试复现并仅规范化该占位符转义；追加秘密文本仍拒绝。
- 最终代码门禁：`pnpm test` 退出 0，627/627 通过，包含 docs lint、typecheck、build 与全部后端测试。`openspec validate add-csv-experience-refinement --strict` 和 `git diff --check` 均退出 0。未改 UI，本阶段未运行浏览器 E2E；不代表后续在线体验验收通过。

## 下次继续的位置

### 2026-09-11 下一可交付阶段收口

- 将交付边界冻结为离线 CSV profile/import、显式模型提炼与独立审核、持久预算和阶段检查点、原子 Markdown 发布及受控恢复；Cognee 和在线并行诊断不纳入本阶段完成声明。
- 新增 `acceptance:experience:local` 与 `acceptance:experience:release`，并补充从安装、私有 store、小批量试用、状态检查到故障恢复和版本回滚的部署 runbook。
- 专项验收 `pnpm acceptance:experience:local` 退出 0，64/64 通过。完整验收首次在无关的 Claude CLI 错误解析测试上因全量并发下 1 秒进程预算失败；该用例单独连续 5 次通过，确认测试夹具把启动性能混入错误解析语义，显式改为 5 秒后再次运行完整验收。
- 最终 `pnpm acceptance:experience:release` 退出 0：后端 693/693、前端 57/57、Chromium E2E 7/7；包含 docs lint、typecheck 和生产构建。Cognee 已新增的未接线 provider 协议测试也包含在后端门禁中，但不代表真实 Cognee 构图/查询验收。
- 1.2、1.3、2.3、3.4 据现有实现与上述证据完成。3.3 保持未完成：用户真实 CSV 已做 profile，但尚未获授权执行真实本地 import 或向真实模型发送小批量内容；明日试用必须先确认发送范围和预算。

### 2026-09-10 总体交付衔接核对

- 更新总体计划第 10 节，纠正仍将源快照、批处理、审核发布与 Skill 描述为未接通的过期状态；保留真实源导入与真实模型质量未验收的边界。当前会话技能目录已能发现 refine-ticket-csv。
- 明确下一阶段入口：A/B 合同验收继续在本 change 记录；D2 runtime 消费者取消贯通可以不依赖 Cognee先行；C 先验证官方实际协议及合成数据闭环，D/E 仍按各自 change 实施与验收。4.1 完成，不代表其他未勾选任务完成。
- 本轮仅修改交付文档与任务状态，未发送工单数据、未导入真实源、未调用模型，也未提交当前工作树。

### 2026-09-10 操作 Skill

- 完成 .agents/skills/refine-ticket-csv/SKILL.md，引用现有命令文档和 schema/产品 Agent 配置；明确本地 profile/import 与模型发送边界、可信身份、固定预算、检查点和受控恢复，不复制产品 prompt。同步修正文档中已过期的“尚未接线”描述。
- 系统和应用 Python 均缺 PyYAML；在独立 /tmp/super-helper-skill-validation.BXOGvv venv 安装 PyYAML 6.0.3 后运行官方 quick_validate，结果 Skill is valid。未修改全局 Python。
- 独立只读前向场景：仅本地整理请求不进入 refine；预算耗尽+换 job 压力不绕过额度、不删锁。检查发现无模型仅发布入口缺失及旧 job 不能增额的工具限制，已明确写入 Skill。没有无 Skill 基线实验，不能据此声称行为准确率提升。
- 本轮仅文档/Skill 修改，pnpm lint 和 git diff --check 通过。3.2 勾选完成；这不代表客户端已重新发现新 Skill，也不代表真实工单/模型验收完成。

### 2026-09-10 中断验收与独立审查修复

- 新增真实子进程在 publication 清单 rename 前/后退出的测试：提交前仍读旧修订，提交后读新修订；显式恢复锁后重试不额外增加修订。该测试对既有实现首次即通过，不声称复现既有崩溃缺陷；不代表磁盘断电验收。
- 复现并修复缺失导入状态、发布清单被当成空库；首次写资产前先提交空清单，有历史资产但清单丢失时拒绝继续。既有 job 目录丢失 job.json 同样拒绝初始化，不能重置预算。
- 独立只读审查复现两个 P2：新 job 重复提炼已发布源、脱敏覆盖截断标记。跨 job 使用通过发布读门禁的当前源修订复用；截断标记优先于 redacted。前者主代理追加测试再次复现 8 次而非 4 次调用，再修复；后者独立审查已复现，补规范化回归。
- 完整 `pnpm test` 669/669 通过（含类型与构建）；之后仅追加截断与丢失 job 预算回归，局部规范化/批次 10/10 通过。文档更新后补跑 lint/diff。真实模型授权与发送范围尚待用户确认，仍可继续离线验收与 Skill 工作。

### 2026-09-10 受控锁恢复

- 三类写入统一使用 owner token/host/pid 锁；释放必须匹配本次 token。显式 recover 仅同主机确认 ESRCH 时重命名保留旧锁，活 PID、未知归属和旧格式不猜测恢复。新增 recovery guard 防止并发恢复互相覆盖。
- 新增 3 测试先因模块缺失失败，实施后与批次集合 7/7 通过；用真实子进程持锁后退出验证恢复，不删除锁证据。CLI recover 通过窄 application/knowledge 用例接线。
- 这证明进程退出后的锁恢复，不等于证明任意磁盘断电/任意发布中断安全；真实崩溃发布、损坏清单与迁移审查继续保留，1.3/2.3 不提前勾选。
- 完整 `pnpm test` 退出 0，666/666 通过（含类型、构建）；更新记录后补跑 lint/diff。真实业务源与外部模型未使用。

### 2026-09-10 状态与映射入口

- 增加 status --job 只读入口，预算/终态计数来自持久任务；不加载模型、不用锁文件伪造运行状态。published 是任务历史记录数，当前发布有效性仍以 publication repository 为准。
- import --mapping 接通严格 UTF-8 有界 JSON 字段映射；支持规范字段到自定义列名，不自动猜测映射。非法文件统一安全错误。
- CLI 测试分别先因旧参数拒绝失败，接线后纳入全量回归；覆盖耗尽预算只读查询且模型调用量不变、自定义列真实 CLI 导入。
- 完整 `pnpm test` 退出 0，663/663 通过（含类型和构建）。3.1 四个命令入口与显式模型 opt-in 验收完成，勾选该任务；1.3/2.3 崩溃可靠性和3.3真实质量仍未验收。更新文档后补跑 lint/diff。

### 2026-09-10 refine CLI 接线

- 新增 configured-run 应用用例，复用现有配置、SecretRef 和 model adapter；CLI 接入 refine，显式 --enable-model true、--config、--job、--max-calls，暂停/模型失败退出码 2，不回显原始内容。
- 真实子进程 CLI 测试先因旧命令不接受 refine 失败，实施后通过；使用回环 HTTP server 验证未启用零请求，启用后两条合成记录四次请求并发布。批次集合 4/4 通过。
- 尚缺 refine 状态查询、显式字段映射 CLI、遗留锁恢复及真实模型质量验收，3.1/3.3 不勾选；本轮未访问外部模型。
- 完整 `pnpm test` 退出 0，662/662 通过，含类型与构建；仅更新说明后补跑文档 lint 和 diff 检查。

### 2026-09-10 阶段检查点

- 增加 refinement-progress schema/port；草稿、审核和内容修订次数按阶段原子保存到 private。重启重新验证来源修订与 schema，已有草稿不重新生成、已有审核不再次请求，继续确定性终检。
- 两个新增测试先复现旧实现不保存草稿/不拒绝跨源检查点，实施后单条与批次集合 16/16 通过。追加跨取消修订上限与零预算复用审核测试；取消不把半成品提升为正式知识。
- 请求返回与检查点写入之间存在不可避免的未确认窗口；当前不能承诺 exactly-once 外部请求。调用预留不退回，异常退出遗留锁仍待受控恢复实现。
- 完整 `pnpm test` 退出 0，661/661 通过，包含类型检查和构建；仅追加说明与验收记录后补跑文档 lint/diff。尚未做真实模型或生产发布验收。

### 2026-09-10 批次应用接线

- 新增 knowledge/refinement-job 与 application/refine-batch，贯通导入源、模型、审定检查点与发布仓库。固定 job 配置/源集合指纹，调用前保存预算预留，重跑跳过终态记录；发布失败后复用 accepted 检查点。
- 初始两项验收因批次模块缺失失败，实施后 2/2 通过；追加发布锁失败恢复测试，不消耗新模型调用。检查点读取重新验证审定对象和 sourceRevision。
- 当前未接 CLI，阶段间半成品仍未保存；中途取消/崩溃后的内容修订次数持久化与遗留锁恢复尚未实现，1.3/2.3/3.1 不勾选。预算预留是调用上限，不是实际 token 或账单费用。
- 完整 `pnpm test` 退出 0，657/657 通过（含类型检查、构建）；仅追加证据和当前边界文档后补跑 lint/diff。未进行真实模型、Cognee 或生产数据发布。

### 2026-09-10 有界传输重试

- 新增 application/model-request，用安全 ModelRequestError.retryable 分类处理瞬态异常；每个阶段最多 3 次实际请求，每次扣共享预算，退避支持取消。传输重试不消耗内容修订机会，也不重启已经完成的草稿生成。
- 三项测试先复现旧实现直接失败/不重试行为，修复后单条提炼集合 10/10 通过；另加取消前禁止再请求用例。跨进程持久预算与 checkpoint 仍未交付，2.3 保持未勾选。
- 本次完整 `pnpm test` 退出 0，654/654 通过，包含类型检查和构建；随后仅更新文档，补跑 lint 和 diff 检查。未联网调用真实模型。

### 2026-09-10 发布仓库增量

- 新增 publication-repository 与严格清单 schema：审定对象重新渲染完整 MD/sidecar，审核记录保留在 private，vault 只保存经过终检的产物；以 private/publication.json 原子切换为查询提交点。
- 发布校验当前导入源修订和原始快照定位，使用与导入相同的 writer.lock；相同草稿/源幂等，不回放生成。读取复核三个 hash，并从审核记录重新渲染比对，不把孤立文件当作已发布知识。
- 新增撤回本地能力；撤回项不返回，重复 publish 不自动复活。真实崩溃注入、旧版本切换、锁恢复、批量应用接线仍待完成，不勾选 1.3/2.3。
- 初始 3 用例因新模块不存在失败；编译后 3/3 通过，覆盖审核失败不发布、幂等、修改 MD 拒读、无清单文件不可见与撤回。此证据是合成离线模块测试，不是系统已切换。
- 本增量 `pnpm test` 退出 0，650/650 通过（含文档检查、类型检查和构建）；`git diff --check` 通过。随后仅追加当前证据与架构边界，补跑文档 lint。

### 2026-09-10 单条提炼与独立审核增量

- 2.2 已注册 experience_refiner / experience_reviewer，新增单条应用用例和端口契约。复用 registry 配置读取，不引入在线回合；源身份与原列名/原始字段哈希不发送。独立审核只消费同一脱敏投影、草稿与宿主哈希。
- 初始 4 测试因新增模块不存在失败；实施后通过。修订反馈测试另外复现仅安全错误码无法定向修订，改为带回原草稿与结构化审核，再独立审核；6/6 局部测试通过。新增附件缺失回归随完整门禁验收，不声称 fake model 证明真实注入防御或真实语义准确率。
- 2.3 部分：单条最多一次内容修订、共享内存调用预算、取消前后检查、安全错误分类。持久化审核记录、网络重试、续跑和发布清单尚未接通；任务仍未整体勾选。
- 未执行真实模型调用、真实源导入或 Cognee；完整 goal 保持未完成。
- 本增量完整门禁首次因旧 registry 固定列表缺少新增阶段失败；保留旧顺序并在末尾追加新 Agent，更新精确断言，局部注册表回归通过。最终 `pnpm test` 退出 0，647/647 通过（含文档、类型、构建）；2.2 勾选完成，真实模型质量仍属于 3.3 未验收项。随后只追加任务/证据文档，补跑 lint 与 OpenSpec 校验。

### 2026-09-10 本地导入增量

- 1.3 部分实现：规范化与机械脱敏、可信 scope/来源实例绑定、私有原始快照与脱敏源分离、源修订幂等、旧/同时间冲突修订隔离、逐行审计、记录间取消与重放。原始快照和状态通过临时文件 fsync/rename 写入。未完成异常退出锁恢复、萃取阶段 checkpoint 和全部损坏恢复门禁，任务保持未勾选。
- 3.1 新接通 import/status 实际 application 路径，CLI 测试先因旧入口只接受 profile 失败，再通过。profile 兼容保留；refine 和映射文件入口尚未接线。
- 新增逐行审计与损坏日期测试先复现失败，再修复；后者防止 NaN 日期绕过版本先后比较。局部 TypeScript 编译及 batch 8/8 通过；此前 CSV、产物、规范化与 batch 集合 32/32 通过（当时 batch 6 项）。完整门禁结果另行追加。
- 未执行真实 CSV import，未调用模型/Redmine/Cognee；仅合成源验收，不能推断真实发布率与线上收益。
- 本增量完整门禁：`pnpm test` 退出 0，640/640 通过，包含 docs lint、typecheck、build；`openspec validate add-csv-experience-refinement --strict` 与 `git diff --check` 退出 0。增量后仅追加本行验收记录，并补跑文档 lint。

1. 完成源记录脱敏、trusted scope/instance 映射与 source snapshot / batch repository（1.3），原文只在受限知识根目录保存。
2. 接提炼与独立审核产品配置、应用用例、预算和 checkpoint（2.2/2.3），补真实 CLI import/refine/status 与 Skill（3.1/3.2）。不要把仅有 renderer 当作自动发布闭环。
3. 明确真实调用发送范围与预算后验收小批量再扩量。总体计划 C—E 仍未实施；用户完整目标保持进行中。
