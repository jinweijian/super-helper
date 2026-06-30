## Context

P0 会让低质量或弱相关知识 fail closed，但当前 tokenizer、chunking 和 taxonomy 仍无法稳定召回自然中文问题。当前 active corpus 中 parent 与 chunk 一对一，长 section 可能混合多个主题；Embedding search 只过滤 active，没有执行请求中的 module/intent/source type/visibility；当前 taxonomy 又只含 `general`，无法可靠限定两个真实业务模块。

本 change 以本地可重建 artifact 为基础完成准确性升级。JSONL 向量仍使用 exact scan；在当前规模下它不降低近邻精度，外部向量数据库不属于本次必要条件。

## Goals / Non-Goals

**Goals:**

- 建立适合中文业务文档的字段加权 BM25 和可解释 matched terms。
- 建立真实 Parent-Child Retrieval，child 用于召回，parent/answer span 用于证据。
- 完成 BM25 + SiliconFlow Embedding + RRF + Rerank 生产组合和完整 metadata filter。
- 隔离 legacy 直答资格，从 source 重建、审计、人工复核并分批发布 v2 语料。
- 用 50 条 production eval 达成 precision/abstention/recall/MRR 门禁。

**Non-Goals:**

- 不引入 GraphRAG、知识图谱或外部向量数据库。
- 不自动批准 warning/error 文档。
- 不改变 public HTTP response 或让 provider 知道 knowledge schema。
- 不让 runtime 或 CLI 实现 chunking、BM25、provider 协议。

## Decisions

### 1. 中文 tokenizer 与 BM25F-like 字段权重

Tokenizer 输出 Latin/alphanumeric token、taxonomy/related term 中的业务词和中文 bigram；不输出普通单字，不在 tokenizer 阶段用 Set 抹掉 TF。停用词只作用于查询与正文 lexical scoring，不删除 title/业务词 provenance。

字段权重固定为：title 4、heading/section path 3、related terms 3、module/intent 2、body 1。BM25 strategy 保留 raw per-field score、rank 和 multi-character matched terms。No-hit 必须允许返回空候选，而不是因为通用字符重叠产生正分。

### 2. Parent-Child artifact 保持 additive compatibility

Parent Markdown 继续是 canonical editable evidence。索引从 source block/section 生成 child：目标 300–800 中文字符，最多重叠一个完整句子且不超过 120 字，不跨 `section_path`。一个 parent 可有多个 `chunk_id`，每个 child 保留 `parent_id`、source block IDs、section path、序号和 text hash。

`chunks.jsonl` 只增加可选字段；旧 reader 可解析。旧 chunk 缺 source block/section 时可用于调查，不具备严格直答资格。Vector manifest 的 source hash 变化会强制 rebuild。

### 3. Parent expansion 返回 bounded answer context

检索命中 child 后按 parent dedupe；最终 evidence 仍引用 parent，但 excerpt 由命中 child 与同 section 的相邻句组成，最大 1600 字。Answer span 选择包含最多 query business terms 且通过 answer-bearing 检查的句子；不存在时保留候选但严格 Judge 阻断直答。

### 4. Hybrid 固定 candidate budget

- BM25 Top 40。
- Embedding Top 40。
- RRF `k=60`，按 chunk dedupe，保留 Top 20。
- SiliconFlow rerank Top 20，返回 Top 8。

Embedding strategy 在相似度计算前执行 module、intent、source type、visibility、status 和 quality eligibility；restricted chunk 仍不发送远程 provider。Provider 失败、凭证缺失或 vector mismatch 时保留 BM25 与 trace，严格 Judge 控制直答。

### 5. Taxonomy 必须覆盖 indexed module

Index audit 比对 parent module 与 taxonomy。`ai-companion`、`edusoho-training` 及产品别名进入 taxonomy；未知 module 产生 warning，并禁止依赖该 module filter 直接回答，直到人工补齐。

### 6. Legacy 语料隔离并分批迁移

P0 门禁自然隔离缺 provenance/quality 的 `semantic-section-v1`。迁移从三个 source 重新运行 extract、normalize、v2 slice、strict audit 和 deterministic repair。人工按 `ai-companion`、`edusoho-training` 两批审核；只有 quality `ok/info` 支持直答。人工接受 warning 的文档可以 active 并供调查，但仍不具备 strict direct eligibility。

发布后重建 chunks/BM25/vector/manifest；旧 artifact 由 source hash/manifest compatibility 失效，不原地猜测迁移。

### 7. 评测集分 calibration 与 holdout

50 条问题固定为：精确 12、同义改写 10、泛词 8、no-hit 8、实现/风险 6、权限/过期/冲突 6。35 条 calibration 用于观察分布但不降低 P0 安全阈值；15 条 holdout 决定发布。门禁：direct precision 100%、no-hit abstention 100%、must-escalate 100%、Recall@5 >= 90%、MRR >= 0.80。

## Risks / Trade-offs

- [Risk] 不输出单字会漏掉真正单字业务词。→ 业务单字必须通过 taxonomy 显式登记，而不是全局字符召回。
- [Risk] Child 边界破坏表格/列表语义。→ 以 source block 为最小单元；超大单 block 标记人工拆分，不静默截断。
- [Risk] 远程 embedding 暴露 internal 文本。→ 仅对允许的 non-restricted published child 调用，报告不记录原文。
- [Risk] 人工复核耗时。→ 分模块发布；未复核内容继续走调查，不降低门禁。
- [Risk] RRF 原始分数不可比较。→ RRF 只负责召回排序；最终直答使用 rerank/严格 eligibility。

## Migration Plan

1. 写 tokenizer/BM25/no-hit、parent-child、vector filter、hybrid budget RED tests。
2. 实现 enriched child artifact 与本地索引 rebuild。
3. 实现中文字段加权 BM25、parent expansion、answer span。
4. 实现 filtered Embedding、固定 Hybrid/Rerank budget。
5. 补 taxonomy 与 50 条 production eval fixture。
6. 对真实 source 生成 v2 drafts、strict report 和人工 review queue。
7. 分批 publish、reindex、vector build、holdout eval；门禁通过后开放对应模块直答。

Rollback：保留 P0 strict gate；移除新 publish batch 或标记 inactive，恢复旧 artifact reader，但不恢复 legacy 直答资格。

## Open Questions

无。外部向量数据库和阈值放宽留给独立后续 change。
