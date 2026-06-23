## Context

第一阶段已经让 configured runtime 使用 retrieval registry，并让 `src/embedding/` 成为纯兼容门面。剩余债务集中在两个“大文件 + 旧调用方”问题：

- `knowledge/indexer.ts` 同时实现文档发现、source metadata 读取、chunk 构建、artifact 写入、keyword 查询评分、evidence 转换和 RAG compatibility wrapper。
- `cli/command-knowledge.ts` 同时解析全局路径、provider flags、11 类子命令、业务调用和输出。
- config、CLI、onboarding、model smoke 等生产代码仍通过 `src/embedding/` 间接访问 provider contract/实现。

本 change 只拆所有权，不改变产品行为或数据格式。

## Goals / Non-Goals

**Goals:**

- knowledge 只拥有本地文档、chunk 和 artifact 行为；keyword ranking/evidence search 属于 retrieval。
- `knowledge/indexer.ts` 和 `cli/command-knowledge.ts` 成为不超过约 120 行的薄 facade/dispatcher。
- 保留旧 knowledge 和 embedding public symbols。
- 所有生产代码直接依赖 `src/providers/`，旧 embedding import 只允许存在于兼容目录和兼容测试。
- CLI 输出、退出码、config、artifact 和 runtime evidence 行为保持兼容。

**Non-Goals:**

- 不删除 `searchKnowledge`、`searchKnowledgeWithRag` 或 `src/embedding/`。
- 不改变 keyword compatibility 算法、权重、过滤、excerpt、evidence ID 或 coverage。
- 不改变 knowledge pipeline 阶段或命令。
- 不引入数据库、远程 provider 或新的 artifact schema。

## Decisions

### 1. Knowledge 本地能力按数据生命周期拆分

目标结构：

```text
src/knowledge/
  documents/
    discovery.ts      # Markdown discovery/frontmatter/source metadata
    chunks.ts         # parent slice -> chunk，artifact fallback 读取
  indexes/
    build.ts          # manifest/chunks/keyword artifact rebuild + quality gate
  indexer.ts          # compatibility re-exports only
```

`documents` 和 `indexes` 不得 import providers、retrieval strategy、runtime 或 CLI。artifact 文件名和 JSON shape 沿用现有 paths/types。

### 2. Keyword compatibility search 迁入 retrieval

`src/retrieval/compatibility-search.ts` 接管当前 `searchKnowledge` 的 query normalization、term extraction、metadata filter、source/confidence weight、排序、excerpt 和 evidence pack 转换。`retrieval/recall/keyword/strategy.ts` 直接调用该 service，不再经 knowledge facade 回跳。

`knowledge/indexer.ts` 静态 re-export compatibility search 和 `legacy-rag` symbol，同时 re-export knowledge discovery/index build functions。兼容依赖只允许出现在这个 facade；其他 knowledge 文件不得 import retrieval。

### 3. Knowledge CLI 使用子命令 handler

目标结构：

```text
src/cli/
  command-knowledge.ts       # subcommand dispatch + usage only
  knowledge/
    context.ts               # config/workspace/path/flag normalization
    command-workspace.ts     # init/update/search
    command-pipeline.ts      # extract/normalize/slice/audit/repair/review/publish/eval
    command-vector.ts        # vector build + provider boundary
    output.ts                # quality summary
```

handler 返回 `boolean` 表示是否消费命令；dispatcher 保留未知命令 usage 和退出码。CLI 只解释参数、组合 service 和打印输出，不复制 knowledge/provider 实现。

### 4. 生产 import 直接指向 providers

- embedding/rerank types 分别从 provider contracts 导入。
- factory/smoke/error helper 从 provider capability/root 导入。
- `src/embedding/` 只为旧外部 import 和现有兼容测试保留。
- `test/embedding.test.mjs`、`test/knowledge-vector.test.mjs` 继续通过旧门面验证兼容；新边界测试扫描 `src` 生产文件。

## Compatibility And Failure Modes

- 索引缺失/dirty：仍从 discovered documents 构建内存 chunks；不改变搜索结果。
- malformed chunk/source metadata/Markdown：保持现有跳过和空结果行为。
- quality warn/error/off：保持报告路径、输出和退出码。
- vector provider disabled/failure：保持原 CLI 文本和安全退出；不输出 secret/vector/raw document。
- pipeline source 缺失、repair plan malformed、review 参数非法、eval failure：保持现有 usage、日志和 exit code。
- 旧 import：通过 facade 得到同名函数和类型，不要求调用方迁移。

## Risks / Trade-offs

- [Risk] 静态 compatibility re-export 形成 knowledge facade 到 retrieval 的依赖。→ 只允许 `indexer.ts` 这一兼容文件依赖 retrieval；真实 knowledge 实现不反向依赖。
- [Risk] 拆分纯函数时 keyword 排序漂移。→ 先增加 fixture/CLI snapshot-style 断言，再逐段原样迁移算法。
- [Risk] CLI handler 返回约定改变 exit 行为。→ 在拆分前锁定正常、非法参数、quality gate 和 unknown command 的 spawn tests。
- [Risk] 路径解析在子模块间重复。→ 唯一放在 `cli/knowledge/context.ts`，handler 共享同一 context。

## Migration Plan

1. 添加边界/尺寸/CLI 兼容 RED tests。
2. 拆 knowledge discovery/chunks/index build，保持旧 indexer exports，运行 knowledge tests。
3. 迁 keyword compatibility search 到 retrieval，运行 knowledge/retrieval/runtime tests。
4. 拆 knowledge CLI handler 并迁移 provider imports，运行 CLI/onboarding tests。
5. 扫描生产 import、执行 Anti-Fake-Complete audit 和全量验证。

回滚可按 knowledge、retrieval compatibility、CLI/import 三组恢复；没有数据迁移。

## Open Questions

无。删除 keyword compatibility 和旧 facade 需要后续独立 change。
