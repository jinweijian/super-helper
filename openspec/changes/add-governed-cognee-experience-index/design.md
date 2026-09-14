## Context

总体计划 C 与 `docs/architecture/cognee-integration-evidence.md` 是设计输入。A/B publication repository 提供已审核不可变 MD/sidecar；D2 已实现模型取消。本 change 不沿用旧手册 RAG 的索引权威，也不改写旧图检索比较实验。

## Goals / Non-Goals

目标：独立索引已发布经验，检索候选回读本地证据，完整支持增量、撤回、重建及权限隔离。非目标：不改变在线默认 pipeline、不生成用户终稿、不把图关系升级为业务事实、不迁移旧 Case。

## Decisions

### 版本与实验先行

候选固定 Cognee v1.5.4/commit `20e0bd88746de2d96e99b4b122361dfc3dad21bc`；官方来源、访问日期与 HTTP 默认值差异见接入证据文档。先在独立仓库外 Python 环境或容器，用私有实验存储和合成数据验证协议；不复用个人默认 Cognee 数据。依赖锁、数据库后端、启动配置和实际 OpenAPI/响应证据随实验记录。

当前不能凭文档猜测来源回读接口：先验证 chunk/document/graph edge 到导入 data 的确定性映射及自定义 metadata 保留；若标准 HTTP 不提供所需证据，记录缺口，评估窄 sidecar，不伪造 source ID 或自动开放任意 Cypher。不得把无法绑定源的字符串答案包装成候选。

### 模块合同

- `src/contracts/experience-index.ts`：中性端口、版本化 capability、已发布输入、候选及安全错误，不承载供应商协议。
- `src/providers/experience-index/cognee/`：HTTP 路径/认证/DTO、完整正文超时与取消；factory 仅装配。只接受 materialized secret；不读 Case/知识根目录。
- `src/knowledge/experience/`：复用发布读取，新增 generation/mapping 状态持久化；不调用网络。
- `src/application/experience-index-service.ts`：冻结发布快照、调用索引 port、确认完成/回读并激活 generation；不编排在线诊断。
- `src/retrieval/experience/`：候选选择、scope/撤回/修订复核、本地原文回读和证据包；不生成最终回复。

先固定远端真实响应，再实现 adapter。原文仅来自 publication repository 的校验后输出，private source/审核记录绝不上传。若未来文档经验进入，同样遵守发布合同，不新增盲目文档切片入口。

### generation 与撤回

以可信 scope、provider instance 和生成批次隔离远端 dataset；本地映射保存 dataset/data/document ID 与 experience ID/revision/hash。dataset 名称不代替 ACL，服务端显式启用后端权限并用读写主体及跨 scope 拒绝测试验证。共享 dataset 使用 UUID。

新 generation 建立完成前保留上一安全版本；构图终态和回读均通过后原子切换。部分成功、超时、取消及重启不得激活不完整索引。撤回在本地立即生效，即使旧 generation/远端共享节点尚未清理也拒绝返回。只清理本应用记录的精确远端对象，不调用全库删除。源发布版本变化时旧命中不得当作当前版本。

### 查询

明确请求 context-only 与引用字段，关闭不必要的最终回答/自动 agentic 调度。候选必须含确定性来源定位；graph-only 摘要最多是未证实方向，不绕过 MD 回读及 Review。查询返回 `completed/no_hit/unavailable/cancelled` 等可区分状态；不可用不是无命中。文本基线仅针对同批 published MD，不回退旧手册链路。

### 安全与兼容

可选能力默认关闭；缺配置不联网，测试不消费真实 token。协议错误、限流、缺凭证、权限错误、畸形/超限响应统一安全 code，不保存正文/secret/隐藏推理。源与映射禁止路径逃逸，读取验证 hash。索引 input hash 与远端 generation 共同防止旧缓存混用；不涉及向量维度兼容推断，按实际后端能力验证。

HTTP/config/Case JSON 保持原形；新增配置须在独立 namespace 中显式启用并有兼容测试。未通过真实索引验收前不向在线查询灰度，不把 fake 模型构图当成真实语义质量验收。

## Risks / Trade-offs

- Cognee 依赖重、环境可能不可用 → 独立环境，先确认安装与最小 import，不改系统 Python。
- graph 来源不完整 → 真实回读门禁；不能用语义相似代替 provenance。
- generation 重建有开销 → 先证明正确性，再在同一合同下优化增量，不永久积累不可清理远端数据。
- 所选数据库权限能力不同 → 固定后端及隔离配置，验证越权查询失败。
- 模型/embedding 费用未知 → 所有真实模型实验显式指定发送范围、模型和调用上限；合成材料不自动意味着无限外部调用授权。

## Migration Plan

先实验，后 port/provider/应用/retrieval 离线回归，最后显式真实服务验收。D5/E 才接入在线主链并迁移旧入口。回退停止新索引/查询，保留源 MD 和上一安全 generation；不恢复已撤回知识。

## Open Questions

待实测：数据库/ACL 配置、HTTP 认证和引用 payload、source 回读能力。真实企业资料与模型使用授权未获确认；不阻挡本地安装、源码/协议检查、合成测试及中性合同工作。
