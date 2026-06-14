---
name: openspec-change-hardening
description: Use when 需要创建、审查或补强 OpenSpec change、proposal、design、spec、tasks，使实现者必须写清完整需求、验收方案、实现边界、测试证据，并防止“接口写出来了但真实边界没守住”的假完成。
---

# OpenSpec Change Hardening

## 核心原则

把 OpenSpec change 写成可执行合同，而不是愿望清单。每个 change 必须让实现者知道“改哪里、怎么改、不能怎么改、怎么证明真的完成”。

**违反字面要求就是违反精神要求。** 不能用“已经有接口”“测试能跑”“大概符合设计”代替真实验收。

## 必用背景

**REQUIRED SUB-SKILLS:** 如果可用，使用 `superpowers:test-driven-development`、`superpowers:systematic-debugging`、`superpowers:verification-before-completion`。如果不可用，也必须执行等价的红绿验证、根因分析和完工前复核。

这个 skill 只用于创建、审查、补强 OpenSpec 文档。真正实现代码时，再进入对应的 apply/implementation skill。

## 工作流

1. 读项目规则、相关 docs、已有 change 的 `proposal.md`、`design.md`、`specs/**/spec.md`、`tasks.md`。
2. 明确 scope、non-goals、模块归属、兼容性、数据流、控制流、失败模式和外部依赖。
3. 把需求写成可验收的 SHALL 场景；每个重要行为都要有正向、负向、边界和回退场景。
4. 把 tasks 拆到执行者不会跑偏的粒度：写明文件位置、接口、实现要求、测试命令、完成证据。
5. 加入“回头重新思考”任务：专门审计哪些地方可能出现假完成，并补充防线。
6. 加入 `implementation-notes.md` 模板或等价证据区，要求实现者逐项记录命令、结果、偏差和风险。
7. 运行 OpenSpec 状态检查；本仓库文档/结构改动还要按 `AGENTS.md` 跑最低验证。

## 必备产物要求

`proposal.md` 必须包含：

- 背景问题、目标、非目标、影响面。
- 这次 change 为什么现在需要做。
- 成功后用户或系统能观察到什么变化。

`design.md` 必须包含：

- 模块边界和职责归属，明确不得放错层的位置。
- 数据流/控制流，从入口到持久化或输出的路径。
- 外部 API 或工具依赖，包含官方文档来源、版本/访问日期、凭证策略。
- 失败模式：超时、空数据、脏数据、旧缓存、权限缺失、限流、解析失败、维度不一致。
- 隐私和安全：不得泄漏 secrets、原始敏感文档、完整用户数据或模型请求明文。
- 兼容策略：旧数据、旧命令、旧配置、旧 API response shape 如何不破坏。
- 完成闸门：哪些测试、命令、人工审核或真实 opt-in 验证必须通过。

`specs/**/spec.md` 必须包含：

- 每条 requirement 使用可验证的 SHALL。
- 每条 requirement 至少一个 Scenario，写清 Given/When/Then。
- 不只测 happy path；必须覆盖错误、降级、缺省配置、无命中或不可用场景。

`tasks.md` 必须包含：

- 小步任务，不写“实现 X”这种大而空的条目。
- 每项任务写明改动位置、实现要求、完成证据。
- 对外部服务默认使用 fake/fixture 验收，真实服务只能 opt-in。
- 明确禁止绕过模块边界、绕过契约、绕过测试或跳过文档。

## 回头重新思考任务

每个 change 都必须在 tasks 中加入一个独立任务，标题类似：

`Anti-Fake-Complete Audit / 回头重新思考`

该任务必须要求实现者停下来回答并补齐：

- 哪些地方可能只是创建了接口、类、文件，但真实数据没有走通？
- 哪些测试可能只测 mock，没有测生产路径或契约？
- 哪些边界可能被写穿：gateway、runtime、agents、sessions、workers、observability？
- 哪些外部 API 细节可能被猜测，没有引用官方文档？
- 哪些命令可能默认联网、产生费用、写入用户目录或污染缓存？
- 哪些数据可能被切片/索引了，但查询无法命中或无法解释来源？
- 哪些旧 artifact、旧缓存、旧 schema 会让测试假绿？
- 哪些 secrets、原始文档、用户数据可能进入日志、fixture 或错误信息？
- 哪些验收必须是真实 opt-in，哪些必须保持 fake/fixture 可重复？

审计结论必须反向补充到 `design.md`、`spec.md` 或 `tasks.md`，不能只写一句“已检查”。

## 任务写法

坏任务：

```markdown
- [ ] Implement MiniMax adapter
```

好任务：

```markdown
- [ ] Implement MiniMax embedding provider adapter in `src/knowledge/embeddings/providers/minimax.ts`.
  Completion evidence: official docs URL/access date recorded; fake fetch tests cover success, missing credentials, timeout, 429, 500, malformed response, and dimension mismatch; no secret appears in logs; `pnpm test -- minimax` passes.
```

坏任务：

```markdown
- [ ] Add knowledge init command
```

好任务：

```markdown
- [ ] Wire `npm run knowledge:init` to the ingestion pipeline without changing default network behavior.
  Completion evidence: command processes fixture documents offline; chunk manifest includes source path, page/section anchors, token estimate, checksum, quality score, and rejection reason; rerun is idempotent; stale chunks are removed or marked inactive; focused CLI tests pass.
```

## 完成闸门

每个 OpenSpec change 至少包含这些 gates：

- Docs gate：引用的外部 API、协议、数据格式必须有官方来源和访问日期。
- Red/Green gate：新增行为先有失败测试或失败 fixture，再实现到通过。
- Fake acceptance gate：默认测试不联网、不花钱、不依赖真实凭证。
- Real opt-in gate：真实 API/真实知识库验证必须显式 opt-in，并记录环境要求。
- Privacy gate：日志、fixture、错误信息不得包含 secrets、完整原文或敏感数据。
- Compatibility gate：旧数据、旧配置、旧 response shape 有迁移或兼容说明。
- No-network default gate：普通 `pnpm test`、`npm run knowledge:init` 的默认行为可控、可重复。
- Diff boundary gate：变更不越过模块边界，不把业务逻辑塞进入口或 route。
- Evidence gate：实现者必须填写命令、结果、偏差、剩余风险和未做原因。

## 最终检查

完成 OpenSpec 文档后，至少执行：

```bash
openspec status --change <change-name> --json
pnpm lint
```

如果命令无法运行，必须在最终回复和 `implementation-notes.md` 中说明原因、影响和风险。不能把“未验证”包装成“已完成”。
