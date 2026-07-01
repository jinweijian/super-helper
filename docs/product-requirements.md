# super helper Product Requirements

> 兼容入口：最新、完整的产品需求文档见 [docs/product/super helper PRD](product/README.md)。本文件保留历史链接，并摘要当前产品口径。

## Product Positioning

`super helper` 是企业内部技术支持首诊助手。它不是通用 Agent 市场，也不是自动修复工具。

用户与 `super helper Agent` 对话；系统可以使用当前项目 `workspace`、企业知识库、历史 case、只读 MCP 工具和 Claude Code Worker，但这些工具不能直接回答用户。

## Primary User Experience

主页面仍然是极简对话页：

- 顶部展示 case 标题与状态。
- 中间是对话时间线。
- 底部是输入框吸底的 composer。
- 用户可以通过 `查看诊断日志` 进入审计层。
- 常用快捷动作包括 `不清楚，继续排查`、`我不认可，重新排查`、`复制结论`。

主聊天只展示用户需要的结论、证据状态、未知项和下一步。Preflight、DiagnosticRequest、retrieval trace、Worker trace、rejected claims、provider payload 等内部细节属于诊断日志，不属于主体验。

## Current Core Workflow

```text
用户提出问题
  -> 创建或续写 Case
  -> 构建 ResolvedTurnContext
  -> 构建 AnswerGoal
  -> Preflight Gate
     -> 信息不足或越权：追问一个最高价值问题
     -> 可诊断：继续
  -> Experience Agent
     -> 安全命中历史答案：转成 history evidence
     -> 未命中：继续
  -> Knowledge Router / Retrieval / Evidence Judge
  -> RAG Answerability
     -> full：知识库直答候选进入 Review
     -> partial：保留 covered claims，带缺口升级 Worker
     -> none/unknown：升级 Worker 或追问
  -> Claude Code Worker 执行只读排查
  -> Result Validator / Evidence Review
     -> 证据不足：追问、继续诊断或输出初步判断
     -> 证据充分：冻结 primary_answer claim
  -> Presentation 仅表达 accepted claim/evidence
  -> 用户质疑或确认解决
     -> 质疑：保留旧 run 并重新诊断
     -> 确认解决：Case Curator 生成 review_required solved case 草稿
```

## Conversation Rules

Agent 必须以用户为中心，但受证据约束：

- 将混乱输入整理为明确 `AnswerGoal`。
- 不把低价值输入直接发送给 Claude Code。
- 当 workspace 已选中且有可搜索业务/技术信号时，不要求非技术用户证明产品、系统或代码路径。
- 支持 `不清楚` 作为有效回答，并把对应信息记录为 unknown。
- 区分 fact、inference、assumption、unknown。
- 用户质疑时，不防御上一轮结论；应识别被质疑 claim，并在合理时开启新 run。

## Output Requirements

Agent 可以输出：

- 一个聚焦追问。
- 带证据缺口的初步判断。
- 有 evidence 支撑的诊断结论。
- 基于已审核证据的操作说明。
- 可复制客户回复。
- 升级给人工技术支持的材料。

每个结论都必须有证据。证据不足时必须明说，不能用自然语言包装成最终结论。

## Diagnostic Log

`查看诊断日志` 是可追溯层，包含：

- Preflight decisions。
- Agent activity。
- Generated DiagnosticRequest payloads。
- Retrieval trace and evidence cards。
- Claude Code Worker run states。
- MCP tool summaries。
- Assumptions、unknowns 和 rejected claims。
- Presentation fallback。
- User challenges and subsequent re-diagnosis runs。
- Case Curator solved case draft events。

## Current PRD Details

完整需求、流程图、时序图、功能需求、权限要求和验收标准见 [docs/product/README.md](product/README.md)。
