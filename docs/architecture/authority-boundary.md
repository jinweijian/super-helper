# 权威排查与信息整理边界

当前交付阶段采用“程序整理、权威方判断”的最小闭环：

1. `super helper` 接收问题，生成唯一的 `DiagnosticRequest` 和 `AnswerGoal`。
2. 程序并行整理会话上下文、经验产物、Redmine 只读证据和代码定位输入；这些内容只能作为输入包，不能直接生成结论。
3. `AuthorityDiagnosticAdapter` 调用权威排查实现。当前实现是 `ClaudeCodeAuthorityAdapter`，未来可替换为 DeepSeek Harness 或其他实现。
4. 权威方返回结构化诊断结果；程序只做 schema、证据引用、敏感信息和可见输出安全校验，不重新判断业务原因。
5. Presentation 将通过校验的权威结论整理成用户可读答复。若本轮没有可验证结论，应明确说明证据状态和下一步，而不是复述用户原话或凭空追问。

## 知识库下线边界

旧文档知识库不再参与在线诊断，也不在设置页提供 Embedding、Rerank 或 RAG 可回答性开关。历史 API 和配置字段暂时保留为迁移兼容，默认 `knowledge.onlineDiagnosisEnabled=false`；它们不代表当前排查会读取旧知识库。

经验沉淀仍从 CSV 生成受治理 Markdown，并通过 `ExperienceGraphProvider` 接入未来知识图谱。图谱是经验索引，不是事实、权限或最终结论的权威来源。

## 验收重点

- 权威方返回的有效 `primary_answer` 不会被程序降级成泛化的“证据不足”。
- 没有第一轮排查结果时不主动要求用户补材料；只有在排查完成且确有未解决项时才追问。
- 取消操作能中断当前权威调用并保留可重试状态。
- 本地测试、真实 CC/替代适配器调用和部署验收分开记录。
