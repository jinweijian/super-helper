# super helper Product Requirements

## Product Positioning

`super helper` is a general-purpose super helper for operational and technical diagnosis. It is not limited to one product, one repository, or one support workflow.

The user interacts with `super helper Agent`. The Agent may use a configured project `workspace`, any configured MCP protocol tools, and Claude Code workers as diagnostic tools.

The first MVP focuses on a calm, chat-first experience:

- Users describe a problem in natural language.
- The Agent decides whether the input is enough for diagnosis.
- If important information is missing, the Agent asks a specific follow-up question.
- Users can answer with real details or say they do not know.
- The Agent dispatches only meaningful diagnostic requests to Claude Code.
- The Agent reviews the returned evidence before explaining conclusions to the user.

## Primary User Experience

The main page is an 极简对话页:

- A case title and status at the top.
- A `查看诊断日志` entry for audit details.
- A conversation timeline in the center.
- A bottom-sticky composer; the 输入框吸底 so users can always find it.
- A small set of contextual quick actions such as `不清楚，继续排查`, `我不认可，重新排查`, and `复制结论`.

The main page should not expose raw run history, tool calls, implementation rules, or verbose trace output. Those details belong in the diagnostic log drawer.

## Core Workflow

```text
用户提出问题
  -> super helper Agent 预检
     -> 信息不足：直接追问用户
     -> 信息足够：生成 DiagnosticRequest
  -> Claude Code Worker 执行只读排查
  -> Agent 审核证据
     -> 证据不足：继续追问或标记不确定
     -> 证据充分：解释判断、列出证据、给出结论
  -> 用户质疑
  -> Agent 接受合理质疑并发起新的 run
  -> 直到问题被完全定位或明确升级人工
```

## Conversation Rules

The Agent must be human-centered but evidence-constrained.

- It should organize messy user input into a clear diagnostic goal.
- It should avoid sending low-value or incomplete input to Claude Code.
- It should ask concrete follow-up questions, not generic “please provide more information”.
- When a workspace is already selected, it should not ask non-technical users to prove the product, system, or codebase if the message contains searchable business terms and can be inspected read-only.
- It must support `不清楚` as a valid answer.
- It should explain what is known, what is inferred, and what is still unknown.
- It should accept user challenge and start a new diagnosis path when the challenge is reasonable.

## Output Requirements

The Agent may output:

- A follow-up question.
- A partial explanation with uncertainty.
- A diagnosis conclusion with evidence.
- A copy-ready case reply.
- A recommendation to escalate to a human technical support engineer.

Every conclusion must be backed by evidence. If the evidence is not enough, the output must say so plainly.

## Diagnostic Log

The `查看诊断日志` drawer contains details that are useful for audit and advanced troubleshooting:

- Preflight decisions.
- Generated DiagnosticRequest payloads.
- Claude Code worker run states.
- MCP tool calls and returned summaries.
- Evidence cards.
- Assumptions and unknowns.
- User challenges and subsequent re-diagnosis runs.

The log is not the primary user experience; it is the traceability layer.
