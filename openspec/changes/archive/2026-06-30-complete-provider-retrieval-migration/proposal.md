## Why

上一轮目录重构已经创建 `src/providers/` 和 `src/retrieval/`，但真实 SiliconFlow embedding 实现仍在 `src/embedding/`，configured runtime retrieval 仍绕回 `searchKnowledge`/`legacy-rag`。目录已经出现、生产调用链却没有完成迁移，现有边界测试因此可能在“假完成”状态下保持绿色。

现在需要完成真实所有权迁移，让 provider、retrieval、knowledge 的运行时依赖与全仓模块规范一致，同时保持现有配置、命令、HTTP、case JSON 和 knowledge artifact 行为兼容。

## What Changes

- 将 SiliconFlow embedding、fake provider、embedding metadata 的真实实现迁入 `src/providers/embedding/`，并将厂商协议拆为 adapter、protocol、endpoint。
- 将 Gemini、MiniMax、Qwen 的安全 unsupported/docs-gated scaffold 迁入各自 provider 子目录；factory 不再引用旧 `src/embedding/`。
- 将 `src/embedding/` 收敛为纯兼容 re-export，并禁止生产代码通过旧门面获取 provider。
- 让 rerank 实现使用中性的 `ProviderError`，同时保留旧 `EmbeddingProviderError` 导出兼容。
- 新增唯一 configured retrieval 组合入口：默认注册 BM25，按配置加入 embedding，fusion 后可选 rerank；禁用或失败时安全降级并保留 trace。
- 将 `legacy-rag.ts` 收敛为调用同一 registry/service 的兼容入口，不再维护第二套策略组合。
- 增加生产路径和导入边界测试，证明运行时真实经过新模块，而不是只证明目录存在。

## Capabilities

### New Capabilities

- `provider-implementation-boundaries`: 约束 embedding/rerank 真实实现、厂商 scaffold、错误类型和旧兼容门面的所有权。
- `configured-retrieval-path`: 约束 configured runtime retrieval 必须经过 registry、BM25/embedding fusion、可选 rerank、trace 和安全降级。

### Modified Capabilities

- 无。本 change 不修改 `openspec/specs/` 中现有产品行为，只补齐上一轮架构迁移承诺。

## Impact

- 主要影响 `src/providers/embedding/`、`src/providers/rerank/`、`src/embedding/`、`src/retrieval/` 及其 focused tests。
- 不改变 public HTTP response、CLI 命令和输出语义、`SuperHelperConfig` shape、case JSON shape 或 knowledge artifact shape。
- 默认验证只使用 fake provider/fake fetch，不联网、不产生费用、不依赖真实凭证。
- SiliconFlow 仍是唯一真实 embedding/rerank adapter；其他厂商继续明确返回 unsupported/docs-gated 错误。
