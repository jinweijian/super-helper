## Why

`7486b9d` 已经建立 Parent-Child chunks、中文字段 BM25、configured Hybrid/Rerank、严格 Evidence Judge、production retrieval eval 和 resolved-turn 证据链，但仓库仍保留 `src/embedding/`、legacy RAG、keyword compatibility search、旧 Knowledge 查询命令和多组 alias-only 入口。这些旧路径绕开或弱化新生产链路，让后续开发者仍可能选错入口；现在需要在不改动新检索算法与迁移语义的前提下，收敛成唯一 canonical API。

## What Changes

- **BREAKING** 删除 `src/embedding/`；embedding/rerank 只从 `src/providers/<capability>/` 导入。
- **BREAKING** 删除 `retrieval/compatibility-search.ts`、`legacy-rag.ts`、keyword compatibility recall、`knowledge/indexer.ts` 的旧 search/RAG/keyword 转发。
- **BREAKING** 删除重复的 `knowledge search`、旧 `knowledge eval` 查询评测 CLI 与 package aliases；知识查询、调试和生产评测统一使用 `retrieval search|debug|eval`。
- 将当前 BM25-only 的 `retrieval search/debug` 改为与 runtime 相同的 configured retrieval composition，而不是保留第二套简化检索。
- 将 knowledge health 和 knowledge acceptance 从旧 `searchKnowledge` 迁到当前 production composition；taxonomy/query-term 规则直接依赖纯函数。
- **BREAKING** 删除无外部消费者的根级/CLI aliases：`src/agent.ts`、`src/server.ts`、`src/claude-worker.ts`、`src/index.ts`、`doctor-command.ts`、`server-commands.ts`、`status-command.ts`。
- 保留并锁定当前优化后的生产路径：Parent-Child、字段加权 BM25、Embedding metadata pre-filter、RRF、Rerank、parent dedupe、answer span、strict Judge、retrieval trace 和 resolved-turn validation。
- 更新 `AGENTS.md` 与架构文档：私有源码不保留历史 import 兼容；真实数据迁移安全与源码 alias 必须分开管理。
- 扩展结构和 production composition tests，阻止旧路径、旧符号、动态绕行或简化版检索重新出现。

## Capabilities

### New Capabilities

- `canonical-internal-module-surfaces`: 定义唯一源码入口、真实 application entrypoints 和必须删除的 alias-only 模块。
- `canonical-retrieval-entrypoints`: 将所有仍在使用旧 search 的生产消费者迁到当前 configured Hybrid/strict evidence 生产链路，并删除重复 CLI/legacy retrieval API。
- `compatibility-budget-policy`: 区分禁止保留的私有源码兼容与为真实持久化数据提供的受控迁移安全。

### Modified Capabilities

- 无。Parent-Child、Hybrid、strict grounding 和 resolved-turn 的正式行为由现有 changes/specs 定义；本 change 只收敛入口并增加不得回退的结构合同。

## Impact

- 主要影响 `src/embedding/`、`src/retrieval/`、`src/knowledge/`、`src/runtime/knowledge-acceptance.ts`、`src/gateway/`、`src/cli/`、package scripts、测试和架构文档。
- 私有 TypeScript imports、旧 Knowledge CLI 和 alias files 是有意 breaking；仓库内调用方同批迁移，不提供 deprecated 转发。
- 保留 knowledge ingestion、vector build、migration-report、extract/normalize/slice/audit/repair/review/publish 等本地知识流水线命令；只删除会制造第二套查询/评测语义的 search/eval 面。
- 保持当前 HTTP/UI、config、SecretRef、case JSON、canonical knowledge source、Parent-Child chunks/vector compatibility 和 fail-closed legacy eligibility 行为。
- 不删除/重写当前 `upgrade-hybrid-parent-child-retrieval` 管理的 artifact、迁移报告、review queue 或真实批次门禁。
- 不新增外部依赖；默认测试继续离线。SiliconFlow 真实验收仍属于显式 opt-in，不是本结构 change 的完成条件。
