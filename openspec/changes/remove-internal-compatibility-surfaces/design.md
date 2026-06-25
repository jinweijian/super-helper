## Context

当前代码基线是 `7486b9d feat: 强化知识检索与会话证据链路`。相关 change 状态：

- `harden-runtime-retrieval-grounding` 已完成：runtime configured retrieval envelope、完整 evidence metadata、strict direct-answer gate 和 production eval 已落地。
- `harden-conversation-evidence-lifecycle` 已完成并正在归档/同步主 specs：resolved-turn、validated experience reuse 和 deterministic review 已落地。
- `upgrade-hybrid-parent-child-retrieval` 的代码任务 1–3、离线验收与文档已完成；真实 source review/publish、SiliconFlow opt-in 和真实 holdout 仍未完成，因此该 change 保持 active。

生产检索路径已经是：

```text
routeKnowledgeQuestion
  -> retrieveKnowledgeWithConfiguredRetrieval
  -> field-weighted BM25 Top 40 + optional filtered Embedding Top 40
  -> RRF k=60 / Top 20
  -> optional Rerank / Top 8
  -> parent dedupe + bounded answer span + grounding metadata
  -> strict Evidence Judge
  -> resolved-turn review/presentation
```

但旧入口仍存在并被部分 CLI、health、acceptance 和测试调用：`searchKnowledge`、`searchKnowledgeWithRag`、keyword strategy、`src/embedding/`、root aliases。当前 `retrieval search/debug` 也仍手动创建 BM25-only service，旧 `knowledge eval` 仍通过 `src/knowledge/eval.ts` 使用 legacy search；这些都会制造两套检索/评测语义。

本 change 必须等当前 Hybrid 代码基线稳定后实施，并且不得与真实语料 publish/reindex 操作并行修改共享 source。未完成的人工迁移/真实 provider 验收可以继续保持 blocked/not-run，不得为了本 change 伪造完成。

## Goals / Non-Goals

**Goals:**

- 删除所有无真实外部消费者的源码 compatibility/legacy/alias 路径。
- 让每个生产消费者只走当前 configured Hybrid + strict evidence canonical path。
- 删除与 `retrieval search|debug|eval` 重复的旧 Knowledge 查询/评测命令。
- 保持新 Parent-Child、BM25F-like、Hybrid budgets、metadata filters、strict Judge、trace 和 resolved-turn 行为不变。
- 把“源码路径兼容”与“真实数据迁移安全”明确区分，防止借数据安全之名长期保留代码别名。

**Non-Goals:**

- 不调整 tokenizer、field weights、chunk size/overlap、40/40→20→8 budgets、RRF k、rerank threshold 或 Judge threshold。
- 不改变 Parent-Child metadata、vector hash/manifest、migration report、review queue、quality eligibility 或 legacy investigation-only 行为。
- 不执行真实 source review/publish、不伪造 50 题真实 holdout、不要求 SiliconFlow 凭证。
- 不拆 Agent Model、Session repository、case curator、UI 或其他大文件。
- 不保留私有 TypeScript aliases、旧 CLI 的弃用期或双轨实现。

## Decisions

### 1. 兼容预算分为源码、产品和数据三类

| Contract | Policy |
| --- | --- |
| 私有 `.ts` import/export、root/CLI aliases | 直接删除并同批迁移调用方 |
| 未交付的重复 CLI (`knowledge search/eval`) | 删除；使用 canonical retrieval commands |
| 当前 HTTP/UI、config、SecretRef、case JSON | 保持行为与 shape |
| canonical knowledge Markdown/source | 不修改 |
| Parent-Child/vector/quality/migration artifacts | 由 active migration spec 管理，本 change 不改 schema |
| legacy artifact eligibility | 保持 fail closed/investigation-only，直到真实迁移完成后由独立 change 删除 |

源码 alias 没有运行时数据价值，不能与旧 workspace 的安全读取混为一谈。后者只有在真实 inventory、明确阻断策略和删除条件存在时才是高可用迁移，而不是永久兼容。

### 2. Canonical source/module map

```text
Executable CLI        -> src/cli.ts -> src/cli/main.ts
HTTP server           -> src/gateway/http-server.ts
Runtime               -> src/runtime/diagnostic-runtime.ts
Worker port           -> src/workers/diagnostic-worker.ts
Claude adapter        -> src/workers/claude/claude-code-worker.ts
Embedding/Rerank      -> src/providers/<capability>/index.ts
Configured retrieval  -> src/retrieval/configured-search.ts
Retrieval CLI/eval    -> src/cli/command-retrieval.ts
Knowledge local API   -> src/knowledge/index.ts
Settings app service  -> src/settings/service.ts
```

保留 `src/cli.ts`，因为它是 `package.json#bin`。模块 `index.ts` 和 `settings/service.ts` 只有在它们是当前唯一正式入口时保留。删除 `src/agent.ts`、`server.ts`、`claude-worker.ts`、root `index.ts` 和三组 CLI alias；生产/tests 直接依赖 owner module。

### 3. Canonical retrieval behavior is frozen by this cleanup

清理前先增加/复用 characterization tests，锁定：

- 中文业务词/bigram/Latin token、TF 与 4/3/3/2/1 字段贡献。
- section-aware multi-child、稳定 hash、parent dedupe、bounded answer span。
- BM25/Embedding 40/40、RRF Top 20、Rerank Top 8。
- embedding 在 similarity/remote submission 前执行 module、intent、source type、visibility、status、quality、restricted/legacy filters。
- provider/vector failure 保留 BM25、trace 与 strict Judge fail-closed。
- evidence metadata、grounding blockers、resolved-turn validation 和 conversation lifecycle 不退化。

本 change 只删除旧入口，不允许用“更简单的 BM25 search”替换当前 production pipeline。

### 4. Consumer convergence

| Current consumer | Final behavior |
| --- | --- |
| Runtime diagnosis | 已 canonical；只做回归证明 |
| `retrieval search/debug/eval` | 保留为唯一查询/调试/评测 CLI；search/debug/eval 全部调用 configured retrieval 或 runtime retrieval evaluation |
| `knowledge search` | 删除命令、usage、测试和文档 |
| `knowledge eval` / `knowledge:eval` | 删除旧查询评测入口；golden-question/production retrieval eval 统一使用 `retrieval eval` |
| Knowledge health query check | 改为 async configured retrieval；HTTP response shape 不变 |
| Knowledge acceptance | 调用 `prepareKnowledgeDiagnosis` 或 production retrieval evaluation，不直接 search |
| Taxonomy/local term rules | 直接调用纯 `knowledge/documents/terms.ts` |
| 旧 keyword/legacy tests | 迁为 canonical BM25/Hybrid/strict-grounding tests，删除兼容相等断言 |

### 5. Source compatibility surfaces are removed atomically

删除：

- `src/embedding/`
- `src/retrieval/compatibility-search.ts`
- `src/retrieval/legacy-rag.ts`
- `src/retrieval/recall/keyword/`
- `includeKeywordCompatibility`、`searchKnowledge*`、`KnowledgeRagSearchQuery` 和 compatibility keyword exports
- `src/knowledge/eval.ts` 的旧 search-based evaluation path、`KnowledgeEval*` compatibility exports 和 `knowledge:eval` package alias
- `src/knowledge/indexer.ts`（discovery/build 由 owner modules 和 knowledge barrel 直接导出）
- `src/agent.ts`、`src/server.ts`、`src/claude-worker.ts`、`src/index.ts`
- `src/cli/doctor-command.ts`、`server-commands.ts`、`status-command.ts`

不创建 deprecated alias，不保留“临时” re-export。结构测试同时扫描 filesystem、静态 import、dynamic import、barrel export、tests 和生成后的 declarations。

### 6. Artifact and active migration ownership remain unchanged

旧 target spec 曾计划删除 keyword/BM25 artifact API；该任务从本 change 移除。当前 Hybrid/Parent-Child change 正在管理 chunks、vector hash、legacy marker、migration report 和 review batches。结构清理不得删除、重写或声称完成这些迁移。

如果源码 compatibility 删除后发现某个 artifact API 无 canonical consumer，只记录后续清理候选；必须由 artifact/migration owner change 决定，不能在本 change 顺手修改 schema。

### 7. External services and privacy

本 change 不新增/修改 provider 协议，不需要重新查询外部 API 文档。现有 SiliconFlow adapter 和显式 opt-in 规则保持不变。默认验证使用 disabled/fake providers，不联网、不付费、不要求真实凭证。

Trace、错误和测试输出继续禁止 secrets、Authorization、原始向量、完整 provider payload、完整知识正文和未经裁剪的用户会话。

## Risks / Trade-offs

- [Risk] 旧兼容测试数量大，迁移时可能误删真正的 Hybrid/grounding 回归。→ 先按新生产合同分类测试，再删除只证明旧 API 存在/相等的断言。
- [Risk] Health 改 async 影响 gateway route。→ route 本身已经 async；锁定 HTTP response fixture 并验证 empty/dirty/no-hit/provider-fallback。
- [Risk] Acceptance 改走 strict production path 后 legacy fixture 大量 abstain。→ 这是正确行为；测试区分 retrieval hit 与 strict direct eligibility，不降低门禁。
- [Risk] 删除 root aliases 后测试不再模拟真实 composition。→ tests 直接 import gateway/runtime/worker owner，与 CLI production wiring保持同一路径。
- [Risk] 与 active Hybrid migration 共享文件产生冲突。→ 开始 apply 前记录依赖状态；不并行改 shared source，不触碰真实 publish/reindex artifacts。
- [Risk] 把 legacy artifact safety 误当成代码包袱删除。→ 本 change 明确不改 artifact schema/eligibility；真实数据兼容由 migration spec 管理并有删除条件。

## Migration Plan

1. 记录 `7486b9d` production behavior baseline，添加 forbidden-path RED tests 和 canonical composition characterization tests。
2. 迁 taxonomy、health、acceptance 和相关 tests 到纯 terms/configured retrieval/strict diagnosis。
3. 将 `retrieval search/debug` 迁到 configured retrieval，删除 `knowledge search/eval` 命令、scripts、usage 和文档；确认 `retrieval search/debug/eval` 覆盖真实查询、调试和评测需求。
4. 删除 keyword compatibility、legacy RAG、knowledge indexer search 转发和 `src/embedding/`，迁完所有 imports/exports。
5. 删除 root/CLI aliases，让 gateway/CLI/tests 直接依赖 owner modules。
6. 更新开发规范和架构文档，执行 Anti-Fake-Complete audit 与全量验证。

回滚使用 Git revert。没有数据迁移步骤，不修改当前 workspace artifact；任何真实迁移 blocker 保持原状态。

## Open Questions

无。新检索算法和真实语料发布由现有 active change 负责，本 change 不重复决策。
