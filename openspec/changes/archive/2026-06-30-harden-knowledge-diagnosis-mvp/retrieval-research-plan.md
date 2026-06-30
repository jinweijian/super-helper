# Retrieval Research Plan

本文件是第 2 项“检索体系升级”的研究方案。它不属于 `harden-knowledge-diagnosis-mvp` 的 apply 任务，不会在本 change 中实现。

## 研究目标

找到适合 `super helper` 企业知识库的下一代检索路线，使系统从当前 MVP keyword search 平滑升级到更高召回、更低误召回、可解释、可溯源的检索架构。

必须保留的产品约束：

- parent slice 是最终回答证据单位。
- chunk 主要用于召回，不能单独作为最终回答依据。
- source document 只做 provenance，不直接作为用户回答上下文。
- Evidence Judge 仍然负责能否直答，不让检索层直接决定最终回复。
- `src/knowledge/` 可以替换检索内部实现，但对 runtime 暴露的 evidence pack shape 应尽量稳定。
- 不让 Claude Code 变成知识检索器。

## 候选路线

### 1. BM25 / Lightweight Inverted Index

适合解决：

- 当前 naive keyword 排序不稳定。
- 中文 bigram 泛词误召回。
- 需要可解释的关键词命中和分数。

研究问题：

- 使用纯本地实现还是引入轻量库？
- 中文分词用 bigram、jieba 类分词、还是混合？
- 如何把 title、heading、related_terms、body、source_type 分字段加权？
- 如何输出 matched terms、field hits、BM25 score 给 Evidence Judge？

评估指标：

- 白皮书已知问题 Top 1 / Top 3 命中率。
- 泛词问题误召回率。
- 查询耗时。
- 无外部服务部署成本。

建议优先级：最高。它是 vector/hybrid 之前最稳的第一步。

### 2. Vector Retrieval

适合解决：

- 用户问法和白皮书措辞差异大。
- 产品/业务语义相近但关键词不重合。
- solved case 经验复用需要语义相似。

研究问题：

- embedding 模型选本地还是远程？
- 向量维度、存储格式、增量更新策略是什么？
- 是否允许把 internal/restricted 文档发给远程 embedding 服务？
- 如何将 vector score 映射到 Evidence Judge 的 score breakdown？

评估指标：

- 同义问法召回率。
- 噪音文档误召回率。
- 索引成本与更新时间。
- 隐私与权限风险。

建议优先级：中高，但必须先回答隐私和部署问题。

### 3. Hybrid Search + RRF

适合解决：

- BM25 擅长精确词，vector 擅长语义相似，二者单独都有盲点。
- 需要稳定召回 top candidates 后再交给 reranker。

研究问题：

- BM25 和 vector 的 candidate pool 各取多少？
- RRF 参数怎么设？
- source_type、confidence、status、freshness 是检索前 filter 还是检索后 rerank？
- 如何保留每个候选的 keyword/vector 双分数供日志解释？

评估指标：

- Top 3 / Top 5 evidence pack 中是否包含正确 parent slice。
- no-hit 误判率。
- Evidence Judge 的直接回答正确率。

建议优先级：BM25 和 vector 原型后再做。

### 4. Reranker

适合解决：

- 候选召回有正确答案，但排序不在 top。
- 需要判断 query 与 evidence excerpt 是否真正 answer-bearing。

研究问题：

- 使用 cross-encoder reranker、LLM rerank，还是本地启发式？
- reranker 输入是 chunk、parent slice 摘要，还是 answer-bearing sentence？
- 对 restricted 文档如何脱敏？
- 何时 rerank：所有 query 还是只 rerank ambiguous hits？

评估指标：

- 正确 evidence 的 MRR / nDCG。
- rerank 延迟。
- 成本。
- 对中文业务文档的稳定性。

建议优先级：中。先建立 evaluation set 再选模型。

### 5. Parent-Child Retrieval

适合解决：

- 长白皮书 chunk 命中后，需要 parent slice 解释。
- parent slice 太大时，需要 answer span / sibling context。

研究问题：

- chunk -> parent -> sibling parent 的展开规则是什么？
- 展开多少上下文仍然 bounded？
- 如果 parent slice 质量差，是否重新切 parent？
- 如何把 source pages / section path 贯穿 chunk 和 parent？

评估指标：

- Evidence Judge 接收到的 parent context 是否足够回答。
- token / excerpt 长度是否可控。
- 是否减少孤立 chunk 误答。

建议优先级：高。它和切割质量直接相关，可以和 BM25 并行研究。

### 6. GraphRAG / Knowledge Graph

适合解决：

- 模块、术语、case、runbook、repo、配置项之间有显式关系。
- 复杂问题需要跨文档推理和路径解释。

研究问题：

- 节点类型：module、feature、term、source_document、slice、case、runbook、repo、code_path。
- 边类型：mentions、depends_on、supersedes、implemented_by、related_to、validated_by。
- 图谱如何从 Markdown frontmatter、section_path、related_terms、related_repos 自动生成？
- 图谱检索是召回前扩展 query，还是召回后解释证据关系？

评估指标：

- 跨模块问题召回率。
- 解释路径可读性。
- 人工维护成本。

建议优先级：低到中。等 BM25/hybrid 和 review workflow 稳定后再做。

## 推荐研究顺序

1. 建立 evaluation set
2. BM25 / inverted index
3. Parent-child retrieval refinement
4. Vector retrieval privacy and prototype
5. Hybrid search + RRF
6. Reranker
7. GraphRAG

## Evaluation Set 建议

先从当前两个白皮书整理 30-50 个问题：

- 10 个 AI 伴学助手产品规则问题。
- 10 个 EduSoho 教培线操作/产品规则问题。
- 5 个同义改写问题。
- 5 个泛词干扰问题。
- 5 个 no-hit 问题。
- 5 个实现细节必须升级问题。

每条样本记录：

```yaml
id: eval_ai_companion_reminder_evening
question: AI伴学助手学习日晚上8点未完成任务会怎么提醒？
expected_parent_slice: knowledge/whitepapers/ai-companion/.../011-8.md
expected_source_document: knowledge/_sources/whitepapers/...
expected_behavior: direct_answer
must_not_call_worker: true
risk: normal
notes: 应命中“学习日晚上8点”切片。
```

## 研究产出建议

- 检索路线对比表：BM25 / vector / hybrid / reranker / GraphRAG。
- 评测集 YAML 或 JSON。
- 每种方案的 Top 1 / Top 3 命中率、误召回率、延迟、成本。
- 推荐第一阶段实现方案。
- 是否需要新增 OpenSpec change 的结论。
