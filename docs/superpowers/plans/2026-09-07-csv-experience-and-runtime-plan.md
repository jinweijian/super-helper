# CSV 经验体系与诊断链路整改处理计划

> 面向实施者：按阶段推进。用户已授权完整目标并选择当前目录实施，保留原有改动。A/B 实施任务的权威来源为 `openspec/changes/add-csv-experience-refinement/`；本文保留总体范围与 C—E 依赖，不重复维护该 change 的细粒度勾选。

**目标：** 以 CSV 批量萃取和 AI 审核生产完整经验 MD，通过 Cognee 提供统一经验检索，按需并行经验与现场代码取证，并修复已发现的诊断链路问题。

**架构：** 离线知识生产与在线工单诊断分离；Markdown/来源快照是权威资产，图索引可重建。在线维持唯一 AnswerGoal、统一协调器、独立取证分支与统一最终审核表达，不按是否启用 Redmine 切换整条 pipeline。

**技术：** 现有 TypeScript/Node/Vue；成熟 CSV parser；Cognee 自托管适配服务；Markdown＋可选 Obsidian。新增依赖和 Cognee 版本在各阶段实施前锁定，不凭未验证 API 编写生产接入。

## 1. 已确定范围

- 工单输入改为导出 CSV，前期不依赖 API 连通性，不自动联网补齐导出内容。
- AI 审核替代逐条人工审核；证据不足自动降级/隔离，不靠模型自评分发布。
- 产物先行，遵守 [经验产物设计](../specs/2026-09-07-experience-artifact-design.md)。2026-09-09 已检查首批真实 CSV：500 条、41 列，原因和处理结果列存在；仅 106 条有最近批注，462 条有附件引用但未提供附件正文，不视为完整历史。
- 经验来源包含工单和未来文档；未来文档复用发布契约，一期不恢复通用 PDF 批量切片平台。
- 最终替换旧文档检索、跨会话答案复用、在线 Redmine 查询规划/重排/分析路径；保留当前 Case 上下文、当前代码/MCP 取证、证据审核、可选来源复核。
- 不在这次计划中引入代码图谱、任意命令执行、生产写操作或无人值守修复。
- 不给复杂调查设置未经验证的短总时限；请求超时、空转检测、任务取消与调查深度分开管理。

## 2. 全局约束

- `DiagnosticRequest.answerGoal` 为唯一主答目标；最终 accepted primary claims 必须覆盖 mustAnswerItems；所有用户可见事实均受审核。
- 工具和 Cognee 不直接生成最终用户回复。移除旧 RAG 专属门禁不等于移除来源、权限和答案覆盖审核。
- gateway 只做 DTO/transport；provider 只做协议；knowledge 只做本地资产；retrieval 只做召回；runtime 只做在线决策；sessions 不调用模型。
- 产品提炼/审核 prompt 放 `src/agents/`，登记 `registry.json`。专用 skill 只负责操作工作流和指向权威标准，不复制第二套产品 prompt。
- 业务知识不写入源码仓库；测试使用合成 fixture，不把真实客户原文提交到 Git。
- 默认测试不联网、不访问 Redmine、不调用付费模型。模型萃取与真实 Cognee 验收显式 opt-in，并声明数据范围和费用预算。
- 所有新分支接收取消信号；同一 Case 的并行分支不得自行写 Case 或各自生成 helper 回复。
- 旧 API、配置、Case JSON、知识索引兼容通过明确迁移保障，不直接改 shape 或物理删除用户资产。

## 3. 在线并行设计

### 3.1 三种方案比较

| 方案 | 收益 | 风险 | 选择 |
| --- | --- | --- | --- |
| 经验后再查代码 | 命中时省 Worker | 未命中增加串行等待 | 作为离线对照，不作为故障默认 |
| 所有消息都双路全量调查 | 容易实现 | 闲聊/简单问题也花钱，重复取证，等慢分支 | 不采用 |
| 模型形成问题与取证计划，故障任务双路启动 | 缩短首次现场取证等待 | 需管理共享目标、取消、冲突和补查 | 推荐 |

```text
消息与 Case 状态 → 模型判断＋确定性权限检查
  ├─ 普通交流／必要追问 → 回复，不启动诊断
  ├─ 可复用知识问题 → 经验检索，按缺口升级
  └─ 可开始的故障调查
          ├─ 经验分支：Cognee 查候选 → 原文回读 → 适用性与出处
          └─ 现场分支：代码定位＋按授权需要调用日志/配置 MCP
                       ↓ 分支完成事件
                 协调器合并证据／检测冲突／必要补查
                       ↓
                 统一最终 Review → 一次最终表达
```

1. 问题解析保留 `respond / ask_user / investigate` 的内部区别，不用非空消息强制覆盖追问；现有 DTO 在映射层兼容。模型失败时只对明确可操作的已知目标做保守只读取证，其余澄清，不静默开启全量调查。
2. 两路使用同一不可变 AnswerGoal、消息截止快照和权限范围。经验分支只检索/回读，不生成终稿；现场分支先基于原始目标做定位，不等待经验命中才启动。
3. 第一期不向运行中的 Claude CLI 强行注入经验、不同时运行同一个 Claude session。经验先完成时暂存候选；现场本次调用完成后结合候选决定下一次有针对性的检查，不重复已有读取。
4. 分支以成功、有用部分、无命中、不可用、取消状态交付证据包。事件驱动收集，不以裸 `Promise.allSettled` 作为唯一决策屏障，也不以 `Promise.race` 的首个结果当正确答案。
5. 初始计划声明必须验证的条件。未完成必需现场检查时，经验不能直接升级成当前根因；存在已审核有用内容可显示固定位置的初步判断，不先生成一整篇终稿。
6. 最终可结束条件：主答覆盖＋必要检查完成或已有等价证据使其不再必要＋无未解决实质冲突。协调器取消无必要的分支，冻结当前证据快照，迟到结果不改变已交付回复。
7. 缺口仍可通过安全工具缩小时继续；需要客户专属选择条件时追问；无新证据、重复相同检查时停止空转并明确缺口。继续调查不靠固定中文问法或单纯计时决定。
8. 经验不可用时允许现场分支继续；代码不可用时只能输出经验候选及限制，除非本来是无需现场证明的知识问题。两路都失败显示明确可重试状态，不当成无相关经验。
9. 普通 MCP 能力独立于经验后端开关；是否调用取决于取证计划和 allowlist，而非是否配置了 Redmine。
10. 批次淬炼和在线请求使用独立并发配额，避免批处理抢占交互模型资源；记录阶段等待、执行耗时、调用量，不预设提速百分比。

## 4. 阶段 A：产物标准与 CSV 入口

### A1. 冻结产物与映射（第一个交付）

**文件：** 本计划、产物设计；实施时新增 `src/knowledge/experience/contracts.ts`、`schema.ts`、`markdown.ts`、`provenance.ts`，测试 `test/experience-artifact.test.mjs`。

**合同：** 输入规范化源记录和审核对象；输出版本化完整 MD、claim sidecar、发布清单。类型以产物设计的字段和枚举为准，统一在 contracts 定义，其他模块不得重复声明。

- [ ] 收到 CSV 后先本地 profile，选择有原因/无原因/有结果/无结果/冲突等样本，输出字段覆盖报告；不要求用户人工审核每条。
- [ ] 写失败 fixture：缺来源、伪造证据别名、处理成功却宣称根因确认、固定版本与受影响版本混淆、draft 混入 published。
- [ ] 实现 schema、规范身份、证据绑定、可读 Markdown 与 sidecar 同源渲染；保存一份合成完整样例作为回归金样。
- [ ] 验证正文修改使原审核失效，不改变已发布不可变修订；文件改名不改变经验身份。
- [ ] `pnpm test` 通过后形成独立提交；交付样本报告、schema 与示例 MD，仍不接生产 Cognee。

### A2. CSV 批次导入

**文件：** 新增 `src/knowledge/experience/csv/profile.ts`、`parse.ts`、`mapping.ts`、`normalize.ts`、`batch-repository.ts`；新增 `src/cli/command-experience.ts`；测试 `test/experience-csv.test.mjs`。

**合同：** 输入文件及可信 scope/列映射；输出规范源记录、逐字段完整性、批次 checkpoint。CLI 只调用应用用例，不解析 CSV 或拼模型请求。

- [ ] 先为多行引号、BOM、编码、重复表头、公式文本、空原因、未知列、重复 ID、乱序快照写失败测试。
- [ ] 实现纯本地预检、明确映射、受限原文快照、模型输入脱敏；保留换行与必要技术语义，不静默截断。
- [ ] 以范围＋工单 ID＋源修订识别增量；部分导出缺行不删除经验；不同文件同内容不重复调用模型。
- [ ] 对单坏行隔离并继续其他记录；文件结构不可解析时停止该批次，不错位拼接字段。
- [ ] `pnpm test` 验证不联网、重跑幂等、越权路径和敏感日志阻断；交付本地导入命令及报告。

## 5. 阶段 B：离线 AI 淬炼与审核

**文件：** 新增 `src/application/experience-refinement/{service,review,publish}.ts`；资产落盘仍在 `src/knowledge/experience/`；新增 `src/agents/experience-extractor.md`、`experience-reviewer.md` 并更新 registry；专用操作 skill 计划放 `.agents/skills/refine-ticket-csv/`；测试 `test/experience-refinement.test.mjs`。

**合同：** 消费 A 的脱敏源记录；产生提炼对象、逐 claim 裁决、发布/线索/隔离结果。应用层通过 model port 调用，skill 调用 CLI/use case，不自行维护平行批次状态。

- [ ] 先写 fake-model 测试：原文提示注入、已关闭但无验证、措施有效但原因未知、前后矛盾、编造版本、缺附件、model 超时、审核格式错误。
- [ ] 实现提炼＋独立上下文审核＋确定性终检；不设置人工逐条批准步骤。最多一次内容修订，失败隔离；瞬态请求重试单独有界。
- [ ] 实现批次暂停/继续、每行 checkpoint、模型/skill/schema 版本记录、费用统计及用户配置的批次调用预算；停止保留已完成记录。
- [ ] 原始私有文本不进入日志、Git 或 Cognee；来源字段值不是系统指令；越权命令不可由 skill 执行。
- [ ] 使用 skill-creator 验证技能结构，并用合成 CSV 前向测试：只能发布支持的经验、不能把未执行建议改成历史事实。
- [ ] `pnpm test` 通过；真实 CSV/模型先少量 opt-in，再扩大；产出完整 MD、结构化审核报告和批次统计，不以高发布率为目标。

## 6. 阶段 C：Cognee 索引与统一经验查询

**文件：** 新增 `src/contracts/experience-index.ts` 定义中性端口；`src/providers/experience-index/{factory,cognee/adapter,cognee/protocol}.ts` 负责协议；`src/application/experience-index-service.ts` 负责发布用例；`src/retrieval/experience/{service,evidence-pack}.ts` 负责召回与回读；测试 `test/experience-index.test.mjs`、`test/experience-retrieval.test.mjs`。

**合同：** 索引端口消费安全文档 ID、revision、文本、scope；返回后端记录 ID/任务状态。查询端口返回来源可定位候选，不返回可直接展示的终稿；retrieval 绑定本地发布清单与原文证据。

- [ ] 先确认 Cognee 固定版本、许可证及所选后端权限支持；在独立实验数据集验证导入/构图/查询/更新/撤回/重建六条真实路径，记录官方 API 对应版本。
- [ ] 写 fake adapter 测试：不可用、部分写入、轮询失败、无来源结果、共享节点旧事实残留、跨 scope 结果、伪造 revision。
- [ ] 实现只导入发布版、generation 切换、任务完成确认、撤回表优先过滤；服务端权限与本地 scope 双重检查，不把 dataset 名字当完整 ACL。
- [ ] 验证 Graph-only 摘要不能绕过 MD 回读和 Review；图解析出的新关系只能是候选，不能升级为审核通过的业务事实。
- [ ] 检索失败显式标为 unavailable；允许经批准的本地已发布 MD 文本回退，不恢复旧手册全量链路。
- [ ] 同批已发布 MD 对比全文搜索和 Cognee：正确候选、适用性、来源定位、更新撤回与延迟；默认测试不联网，真实验收显式 opt-in。
- [ ] `pnpm test` 通过；只有真实回读和失效验证通过，才允许灰度查询。

## 7. 阶段 D：运行时问题整改与并行编排

基础修复可在 A/B 期间独立实施，但不要等待 Cognee 上线才修。

| 编号 | 问题与改动位置 | 必须证明的行为 |
| --- | --- | --- |
| D1 | `src/runtime/preflight-service.ts`、`preflight-decision.ts`、`src/agents/input-review.md` | 明确客户选择缺失时保留必要追问；问候不启动 Worker；具体可检索故障不先索要代码路径；模型失败可控降级 |
| D2 | `src/providers/model/adapter.ts` 及模型调用消费者、`investigation-control.ts` | 取消信号贯穿 Preflight/检索/审核；响应头早到正文延迟仍能超时；取消关闭响应读取并清理计时器 |
| D3 | `src/mcp-servers/redmine/redmine-api/client.ts`、`normalizer.ts` | 保留旧入口期间修正文读取超时；字段别名可配置并标记完整性；隐私过滤不回退；CSV 路径不依赖此客户端 |
| D4 | `src/mcp-servers/redmine/redmine-api/search.ts`、`src/mcp/historical-case-evidence-service.ts` | 保留旧调用期间报告扫描覆盖/有无后续页/更新范围；未全量扫描不能推断全库不存在；内部 metadata 不破坏既有 DTO |
| D5 | `src/runtime/diagnostic-runtime.ts`、`runtime-composition.ts`、新增 `src/runtime/investigation/{plan,coordinator,branch-results}.ts` | 经验后端开关不影响通用 MCP；两路输入不可变；只有协调器修改 Case；单路失败、取消、迟到、冲突均有稳定输出 |
| D6 | `src/runtime/worker-diagnosis.ts`、`review-presentation.ts` | 把继续调查决策与最终表达分开；中间 review 不生成无用终稿；保留取消/Deep 失败时已接受的初步判断 |
| D7 | `src/sessions/context-builder.ts`、新增 `src/contracts/investigation-state.ts` 与 session state repository | 保存已执行检查、反证、缺口及其证据引用；按相关性取回而非仅最近三轮；状态不是另一份自由文本总结 |

### D 阶段实施循环

- [ ] D1—D7 每项先写对应失败测试，分别形成可验收提交，禁止捆绑成一次大重写。
- [ ] D2 增加本地 HTTP 延迟响应体测试，而不只 mock fetch 的响应头；同时测试用户取消、超时、异常和正常完成均无资源残留。
- [ ] D5 用可控 deferred 分支测试真实并发启动，经验先到/代码先到/单路失败/双路失败/任务取消/迟到消息；不得以“调用过 Promise.all”作为并行验收。
- [ ] D5 检查经验与现场冲突时保留反证并补查，不能把“检索到类似案例”包装成当前根因；普通知识问题允许不跑代码。
- [ ] D7 采用独立版本化状态存储，通过 CaseRepository port 访问；原 Case JSON 不改形。旧 Case 首次读取构建可解释的空/有限状态，不虚构已验证检查。
- [ ] 保存稳定检查 ID、目标版本和 evidence fingerprint，重试只做未完成检查；恢复前重新验证 workspace/revision 是否变化。
- [ ] `pnpm test`、`pnpm test:web`、`pnpm test:e2e`；覆盖进度、停止、重试、最终唯一回复和旧 Case 打开。延迟测试记录实际并发区间，而非仅看结果文字。

## 8. 阶段 E：切换、去旧与验收

**改动范围：** 旧 `experience-turn.ts`、`knowledge-turn.ts`、`case-investigation/` 的在线装配及调用点；Agent registry；settings/onboarding/CLI；`scripts/verify-docs.mjs`；相关 docs 和 OpenSpec。

- [ ] 新增明确 pipeline 版本/模式配置；未迁移的旧安装保持原行为，用户选择迁移后新回合使用统一经验路径；运行中回合不切换。
- [ ] 先只读 shadow 对比离线回放，不在每个生产回合双跑付费旧新模型；灰度按 workspace，记录新旧版本。
- [ ] 新模式不调用旧手册 RAG、跨会话答案直复用、Redmine query/rerank/analyze；通过 spy/契约测试证明，不仅隐藏设置菜单。
- [ ] 当前 Case 消息与调查状态保留；已发布的旧经验如需迁移，走同样来源和 AI 审核，不能默认全部可信。
- [ ] 旧 API response shape 保持；旧配置可读取；旧知识命令给出明确弃用行为和迁移入口。正式移除兼容接口另列版本窗口，不悄悄让旧命令触发新付费流程。
- [ ] 旧知识目录/Case 数据不删除；回退配置可切回旧版本，但不能重新放出已撤回或越权知识。
- [ ] 更新 docs 的运行时事实和检查脚本，删除“必须存在旧 RAG Agent 文案”式耦合检查，用现存阶段注册及行为验证替代。
- [ ] 在新链路稳定且兼容窗口结束后，删除无消费者旧实现与测试；保留有效通用能力，不永久维护两套主链路。

## 9. 最终验证与反假完成审计

验收分成三个层级，不能用数量或“构图成功”代替效果：

1. 产物：正文中的事实与措施能回到 CSV 单元格；未知不补写；同工单修订可追踪；敏感数据不外泄。
2. 知识：查询返回正确经验及原文；不同版本/同症状异原因能区分；撤回、部分导出、重跑和后端不可用均正确。
3. 诊断：相同问题、模型与工具权限下，比较旧流程、经验优先串行、新并行流程的首次有效回复时间、总耗时、调用费用、错误结论、有效解决/升级质量。按故障复杂度分组，报告 p50/p95，不以跨不同时期的历史耗时证明提速。

训练/萃取样本与评测问题按根因族或时间分组隔离，防止同一工单改写泄漏到评测集。真实工单数量由用户提供的数据决定；先检查小批量各类型，再扩量，不承诺未测准确率。

- [ ] 审计 CSV 是否真包含声称的历史；原因字段映射是否漏掉；模型是否把工单指令当系统指令。
- [ ] 审计 AI 审核是否只是读提炼者自评；两模型一致是否错误地等同真实验证。
- [ ] 审计 Cognee 上传成功但未构图/不可回读、旧图共享节点、索引混入草稿、Obsidian 修改绕过审核等假完成。
- [ ] 审计并行实际仍串行、隐藏等待全部来源、重复调用、取消后继续付费、迟到结果覆盖新回合。
- [ ] 审计旧 API/Case/日志与 frontend shape 兼容，文档是否仍描述两条旧 pipeline。
- [ ] 每阶段记录测试命令、实际输出、红绿证据、真实验收版本、费用、偏差与未验证项；不得把本计划勾选当作代码完成。

### 命令与交付门槛

- 本次文档交付：`pnpm lint`，期望退出码 0；不表示实现完成。
- 各 TypeScript 阶段：`pnpm typecheck`、`pnpm build`、`pnpm test`；修复功能测试先红后绿。
- 影响 UI：再运行 `pnpm test:web`、`pnpm test:e2e`。
- 阶段进入实现前创建独立 OpenSpec proposal/design/spec/tasks，运行 `openspec status --change <实际名称> --json`；不修改或冒充旧图检索调研已完成。

## 10. 下一步输入与当前交付

用户提供首份 CSV 后从 A1 开始，先报告字段和内容覆盖，再产出少量可读经验 MD 与 AI 审核结果供观察；观察是验证产品输出，不要求用户逐条批准发布。

当前进度（2026-09-10）：首批 CSV 只读检查与正文样例已完成。`add-csv-experience-refinement` 已接通 profile/import/refine/status、显式字段映射、私有源快照、独立审核、同源 MD/sidecar 原子发布、预算与阶段续跑，以及受控遗留锁恢复。操作 Skill 已创建并通过格式验证，当前会话技能目录已能发现它。上述闭环经过合成 CSV、fake model 与回环 HTTP 的真实 CLI 测试；不等于真实模型的提炼质量验收。

### 剩余交付顺序与进入条件

1. **A/B 收尾：** 以 `add-csv-experience-refinement/tasks.md` 为唯一实施清单，逐项核对合同与回归证据。真实 CSV 目前仅完成 profile，尚未导入；生产导入前明确可信 scope/source instance 与仓库外存储根目录。模型验收另需明确允许发送的脱敏数据范围、模型和调用上限，先小批量观察错误类型再扩量，不要求用户逐条审核。原始资料不入 Git。
2. **D2 模型取消已接通并完成本地验收：** `propagate-runtime-model-cancellation` 覆盖 Preflight、知识/历史案例模型消费者与审核表达；新增真实浏览器停止模型正文、本地 HTTP 和并发 Case 隔离验证，保留已审核初步判断。非模型 MCP/embedding 传输和旧 allSettled 等待仍由后续 D5 治理；不代表整体诊断提速或远端停止计费已验收。
3. **C 经验检索：** 按第 6 节验证实际 Cognee 版本、许可及官方接口，用合成经验验证索引、查询、更新、撤回与重建，再接统一检索 port。正式发布 MD 是权威资产，图是可重建派生索引；未验证的图服务不进入在线默认路径。
4. **D 其余运行时能力：** 按第 7 节分别治理预检、证据覆盖、调查状态和选择性并行。经验是排查方向，不自动成为现场根因；只有证据不足才继续深查，不设置一刀切任务时限。
5. **E 切换与效果验收：** 经过契约兼容、离线回放与真实服务验证后再切新模式，证明不再调用旧检索链路，保留回退与原数据。最终按第 9 节比较准确性、首次有效回复时间、总耗时及成本，未经测量不承诺提速。

本地代码仍在当前目录、保留用户原有修改，未提交或推送。具体逐轮命令与边界见该 change 的 implementation-notes；Cognee、在线并行、旧链路迁移及整体效果验收仍未完成。
