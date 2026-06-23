## Why

当前 configured runtime retrieval 已切换到 BM25/Embedding/RRF 组合路径，但真实中文知识库会把单字重叠当成高相关，且迁移后的 Evidence Pack 丢失质量、时效和 provenance。结果是质量错误或不相关文档仍可能被 Evidence Judge 以高分直接回答，而现有 `knowledge eval` 又未执行生产检索路径。

必须先建立严格的检索证据合同和直答门禁，在提升召回能力之前消除“检索错但回答很确定”的风险。

## What Changes

- 为 configured retrieval 增加 runtime 使用的 evidence + trace 结果合同，并保持旧 Evidence Pack 入口兼容。
- 从 parent 文档和质量报告补齐候选的类型、时效、source provenance、质量状态、策略分数和 answer span。
- 将知识直答改为严格门禁：低质量、缺 provenance、过期、冲突、风险、实现细节、弱相关或无明确答案句时必须降级或升级只读调查。
- 将 SiliconFlow Embedding/Rerank 作为当前部署的显式 opt-in 路径；默认配置和普通测试继续离线。
- 新增生产路径 retrieval evaluation 和可观察 trace，覆盖真实中文误召回、no-hit、provider 降级和安全阻断。
- 保持 HTTP response shape、case JSON 必填字段和旧 knowledge artifact 可读性不变。

## Capabilities

### New Capabilities

- `retrieval-evidence-contract`: 定义 runtime retrieval evidence、trace、质量、provenance、策略分数和 answer span 的完整合同。
- `strict-knowledge-answer-gate`: 定义知识直答、阻断、降级和代码升级的确定性安全门禁。
- `runtime-retrieval-evaluation`: 定义使用生产 Router/Retrieval/Judge 路径的评测、指标和发布门禁。

### Modified Capabilities

- `knowledge-diagnosis-hardening`: 强化 Evidence Judge、质量门禁、可观测性、真实验收和兼容要求，使其消费完整 retrieval metadata 而不是只依赖 matched term 数量。

## Impact

- 主要影响 `src/retrieval/`、`src/runtime/knowledge-diagnosis.ts`、`src/runtime/evidence-judge.ts`、`src/runtime/event-recorder.ts` 和 retrieval/runtime tests。
- `src/knowledge/` 继续只负责本地文档、质量报告和 artifact 读取，不接管 retrieval 排序。
- `src/providers/` 继续拥有 SiliconFlow 协议；runtime 不直接创建 provider。
- 新增 CLI 评测能力时，CLI 只做参数和输出适配，不复制 retrieval 或 Judge 逻辑。
