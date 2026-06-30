## Why

当前本地 RAG 链路在排序、召回、切片三个层面都有可观测的质量损耗，导致"换种说法就搜不到""rerank 形同虚设""超长段落被直接放弃切片"等问题。具体瓶颈：

1. **rerank topN=2 让 rerank 失效**：`config.rerank.topN` 默认 2，但 fusion 后会送入最多 20 个候选；provider 只返回 top 2，其余 18 个按原序补回。最终 `limit=8` 的结果里只有 2 条由 rerank 主导，cross-encoder 的精度优势被浪费。
2. **parent 去重在 rerank 之后**：同 parent 的多个 child 会各自消耗一次 rerank 配额；若两个 rerank 结果恰好同 parent，去重后只剩 1 条有效，等于白白浪费一次远程调用。
3. **finalScore 量纲不匹配**：`finalScore = RRFScore + rerankScore` 直接相加。RRF 值约 0.1–0.5，rerankScore（bge-m3）范围不定且可能 >1，直接相加会让 rerank 没有真正主导最终排序。
4. **embedding 默认关闭**：`buildVectorIndex: false`、`embedding.enabled: false`。用户不手动开启时只有 BM25 单路词法召回，同义词、口语换述、书面 vs 口语完全召不回——这是"检索不精确"的根因之一。
5. **无 query 归一化/扩展**：原始 query 直接进 tokenize 与 embedding。全/半角、繁简、缩写都会丢召回；而 taxonomy 的 `aliases` 在 BM25 strategy 里已加载却从未用于 query 扩展。
6. **切片参数全硬编码**：800 字符上限、overlap 仅在拼接超限时取上一 block 末句（≤120 字符、只匹配中文标点）。单 block 超 800 直接标 `manualSplitRequired` 结束，没有滑动窗口递归切。

provider 可默认依赖（SiliconFlow key 部署环境可用），因此可以把双路召回作为默认路径。

## What Changes

- **阶段 A（零成本排序快赢）**：rerank `topN` 默认 2→8；把 parent-dedupe 移到 rerank 之前（同 parent 只送代表 child 进 rerank）；rerank finalScore 改为 min-max 归一化后的加权融合（rerank 权重 0.7 主导）。
- **阶段 B（语义召回根因）**：默认启用 embedding 双路召回（`embedding.enabled`、`knowledge.buildVectorIndex` 默认 true，无 key 优雅降级为纯 BM25）；新增 query 归一化（全/半角、繁简、空白、标点）与基于 taxonomy aliases 的同义词扩展，召回用扩展 query、rerank 用原始 query。
- **阶段 C（切片质量）**：切片参数外置到 `config.knowledge.chunking`（maxChars/overlapStrategy/overlapChars/minChars）；超长 block 改为按句子边界滑动窗口递归切，不再强制 manualSplit；`chunking_strategy` 升级 `parent-child-v2 → parent-child-v3`、`artifact_version 2 → 3`，触发既有向量兼容性校验自动重建索引。

## Capabilities

### Modified Capabilities

- `knowledge-diagnosis-hardening`: 修改切片参数化、chunking_strategy 版本、rerank 排序顺序、finalScore 归一化、默认双路召回、query 归一化扩展等检索与切片要求，使本地检索在默认配置下达到双路召回 + 正确 rerank 主导的预期质量。

## Impact

- 主要影响 `src/retrieval/`（service 排序顺序、rerank 归一化、新增 query 归一化扩展）、`src/knowledge/documents/chunks.ts`（切片参数化与递归切）、`src/config.ts`（默认值与新增 chunking 配置）、`src/onboarding/`（默认开启向量构建）。
- chunking_strategy 版本升级触发全量向量索引重建（既有 `checkKnowledgeVectorCompatibility` 机制已支持，无需新代码）。
- 不改 HTTP response shape、不改 case JSON shape、不改 provider 抽象、不引入向量数据库。检索默认路径从单路 BM25 变为 BM25+Embedding，但无 key 时优雅降级，行为可回退。
