## Context

`DiagnosticRuntime` 当前既是组合根，也是九类业务能力的实现者。它直接解析 knowledge workspace 路径，操作 session 状态，执行模型 Preflight，复用历史经验，编排 knowledge answer、worker follow-up、Evidence Review 和 presentation。`settings/service.ts` 同样把 DTO contract、SecretRef、公开响应和三类设置 mutation 写在一个文件中。

这两个文件都有较强兼容要求：gateway、sync/async chat、tests 和外部调用方依赖现有 public symbol。因此本 change 采用“先提协作者、最后缩入口”的方式，不重写流程状态机。

## Goals / Non-Goals

**Goals:**

- `DiagnosticRuntime` 只装配协作者并按既有顺序执行用户回合，控制在 300 行以内。
- 每个 runtime 协作者只拥有一个可一句话描述的职责，并通过显式输入/输出协作。
- 同 case 串行、同步/异步共用管线、Evidence Review、Deep Query retry、所有现有事件顺序保持兼容。
- runtime 组合根不 import knowledge 路径、索引或 provider 实现。
- `settings/service.ts` 只 re-export，设置实现按 contract/public/secret/model/provider/Claude 拆分。
- 保持 gateway route、HTTP DTO、config 保存、secret 脱敏和 smoke test 行为。

**Non-Goals:**

- 不改变 Agent prompt、Preflight 决策规则、evidence judge、presentation 文案或模型参数。
- 不改变 worker adapter、case repository、事件 schema、case 状态枚举或重试次数。
- 不改变 settings API 字段、SecretRef shape 或 provider 默认值。
- 不引入依赖注入框架、事件总线或新的持久化层。

## Decisions

### 1. DiagnosticRuntime 保留为组合根

目标协作者结构：

```text
src/runtime/
  diagnostic-runtime.ts       # public facade + turn ordering only
  turn-queue.ts               # same-case serialization
  session-lifecycle.ts        # load/create/start/failure/pending reply id
  preflight-service.ts        # local/model preflight and reconciliation
  experience-turn.ts          # prior reviewed answer reuse
  knowledge-turn.ts           # knowledge diagnosis and escalation
  worker-diagnosis.ts         # worker dispatch + one Deep Query retry
  review-presentation.ts      # Evidence Review + final formatting
  case-curation-service.ts    # resolution confirmation -> solved-case draft
  contracts.ts                # internal turn/review result contracts
```

构造函数仍只接收 config、store、worker。组合根创建 model、event recorder 和协作者；外部调用方不需要迁移。

### 2. 协作者通过窄 contract 协作

- `SessionLifecycle` 独占 case create/load、用户消息写入、persona/title/status 和失败回复。
- `PreflightService` 返回现有 `PreflightDecision`，不写最终回复。
- experience、knowledge、curation service 返回可选 `RuntimeTurnResponse`；未命中返回 `undefined`。
- `ReviewPresentationService` 只产生 review reply/decision，不决定 worker 是否重试。
- `WorkerDiagnosisService` 负责 run、worker trace、follow-up request 和 Deep Query retry，返回最终 review。
- `DiagnosticRuntime` 保留固定顺序：curation -> experience -> preflight -> knowledge -> worker -> presentation message。

### 3. Knowledge 路径只在 knowledge/curation 协作者内部解析

`diagnostic-runtime.ts` 不得 import `knowledge/index.ts`、provider factory 或 artifact path helper。knowledge turn 和 case curation service 可以通过现有 knowledge public service 访问 workspace root；它们不向 gateway 暴露路径细节。

### 4. Settings 使用薄 facade 保留旧导出

目标结构：

```text
src/settings/
  contracts.ts          # request input and secret store contracts
  public-view.ts        # config/public/agent response mapping
  secrets.ts            # submitted secret application and configured check
  model-settings.ts     # model mapping/update/smoke
  provider-settings.ts  # embedding/rerank mapping/update/smoke
  claude-settings.ts    # Claude setting mutation
  service.ts            # compatibility re-exports only
```

gateway 继续从 `settings/service.ts` 导入相同函数。各 mutation service 保存 config 后调用统一 `publicSettings`，避免复制 HTTP response mapping。

## Compatibility And Failure Modes

- 同 case 多个异步回合必须按接收顺序执行；一个失败不能阻断队列后续回合，队列完成后释放 map entry。
- archived/missing case、model Preflight 失败、worker timeout/error、review model malformed、knowledge no-hit 和 case curation 不适用时保持现有行为。
- worker follow-up 最多执行既有一次，Deep Query event payload、约束和 prior evidence context 不变。
- settings 缺 provider、非法数字、提交 apiKey/apiKeyEnv、禁用 embedding/rerank 和 smoke failure 保持现有 status/body 与脱敏行为。

## Risks / Trade-offs

- [Risk] 提取协作者时事件顺序漂移。→ 先用现有集成测试和新增 phase 序列断言锁定，再原样移动调用。
- [Risk] shared dependency 过多导致“类拆了但耦合没降”。→ 每个协作者构造参数只包含实际需要的 config/store/model/events/worker/reviewer。
- [Risk] facade 重导出造成循环依赖。→ 实现模块只能 import contracts/public-view/secrets，禁止反向 import `service.ts`。
- [Risk] runtime helper 直接返回公开 response 形成耦合。→ 使用 `contracts.ts` 的内部结构，`AgentResponse` 由 facade 兼容导出。

## Migration Plan

1. 添加 runtime/settings 文件尺寸、禁止 import、协作者存在和真实委托 RED tests，并记录现有行为基线。
2. 提取 settings contracts/public/secret 与各 mutation service，缩薄 facade，运行 settings/gateway tests。
3. 提取 queue/session/preflight/review，再提 experience/knowledge/curation/worker services。
4. 缩薄 `DiagnosticRuntime`，运行 runtime、async、gateway、worker 和 knowledge acceptance tests。
5. 执行 Anti-Fake-Complete audit、生产 import 扫描和全仓门禁。

所有迁移均不涉及数据 schema，可按 settings 与 runtime 两组独立回滚。

## Open Questions

无。后续若要把 event recorder 或 model prompt 再分层，应另开 change。
