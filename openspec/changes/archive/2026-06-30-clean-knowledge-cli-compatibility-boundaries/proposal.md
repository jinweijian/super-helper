## Why

Provider/retrieval 的真实路径已经完成迁移，但 `src/knowledge/indexer.ts` 仍混合文档发现、chunk 构建、artifact 写入、keyword 评分和 RAG 兼容接口，`src/cli/command-knowledge.ts` 仍用近 400 行承载所有子命令。多个生产模块也继续从旧 `src/embedding/` 门面导入，导致兼容层无法真正收敛。

本 change 将这些职责拆到明确目录，并让旧 public symbol 只做兼容转发，同时严格保持知识检索、CLI、onboarding、config 和 artifact 行为不变。

## What Changes

- 将 knowledge 文档发现、source metadata 读取、chunk 构建和索引 artifact 构建拆到 focused modules。
- 将 legacy keyword 搜索的评分、过滤、排序和 evidence 转换迁到 retrieval compatibility service。
- 将 `src/knowledge/indexer.ts` 收敛为不超过约 120 行的兼容 re-export facade，保留 `searchKnowledge`、`searchKnowledgeWithRag` 等旧符号。
- 将 knowledge CLI 拆为 context、workspace/index、pipeline、vector、output 子模块，`command-knowledge.ts` 只负责分发。
- 将 CLI、onboarding、config 和其他生产调用方改为直接依赖 `src/providers/`；旧 embedding import 仅允许出现在兼容模块和兼容测试。
- 增加文件尺寸、禁止 provider-shaped interface、禁止生产 legacy import 和 CLI 输出兼容测试。

## Capabilities

### New Capabilities

- `knowledge-local-module-boundaries`: 约束 knowledge 的文档、chunk、artifact 所有权，以及 retrieval compatibility search 的归属。
- `knowledge-cli-decomposition`: 约束 knowledge CLI 的薄分发、子命令模块和输出兼容。
- `legacy-embedding-import-boundary`: 约束生产代码直接依赖 providers，旧 embedding 目录仅服务兼容调用。

### Modified Capabilities

- 无。本 change 不修改现有产品需求，只重构内部所有权并保护兼容行为。

## Impact

- 主要影响 `src/knowledge/`、`src/retrieval/`、`src/cli/`、`src/onboarding/`、`src/config.ts` 和相关测试。
- 不改变 CLI 命令名、参数、退出码、代表性输出、HTTP response、config shape、case JSON 或 knowledge artifact shape。
- 不新增外部服务或网络调用；默认测试继续完全离线。
