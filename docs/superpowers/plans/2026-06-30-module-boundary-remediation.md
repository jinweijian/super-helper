# Super Helper Module Boundary Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复当前代码逻辑中不符合仓库规范的模块边界、事实审核、配置一致性和可维护性问题。

**Architecture:** 先收紧最终回复链路，保证 Presentation 不能引入未审核事实；再把 knowledge 资产写入从 runtime 移到 knowledge owner；随后同步 Agent metadata、配置文档和 gateway DTO 默认行为。大文件拆分放在最后执行，避免和前面行为修复互相干扰。

**Tech Stack:** TypeScript, Node.js test runner, OpenSpec, pnpm, existing `src/runtime`, `src/knowledge`, `src/gateway`, `src/agents` modules.

---

## Scope

本计划只处理已审查出的规范偏差：

- Presentation 事实输出校验不足。
- runtime 直接写 knowledge solved-case 资产。
- case review runtime 使用 `defaultConfig()` 推导 workspace root。
- `output-review` Agent metadata 与当前责任不一致。
- embedding 默认值的主架构文档与配置/OpenSpec 不一致。
- session DTO 默认触发 knowledge health 查询，职责偏重。
- 大文件拆分债务仍未完成。
- 根级 deprecated re-export 需要删除窗口和禁止新增引用策略。

不在本计划内：

- 不重新设计产品 Agent 提示词体系。
- 不变更持久化 case JSON shape。
- 不改变现有 API response shape，除非先补 OpenSpec 说明和兼容测试。

## File Map

- Modify: `src/runtime/review-presentation.ts`  
  收紧 Presentation 输出校验，只允许从 accepted claims/evidence 派生最终答复。
- Modify: `test/supper-helper.test.mjs`  
  增加 Presentation 事实防泄漏、case review 配置、Agent metadata、DTO health 默认行为等回归测试。
- Create: `src/knowledge/solved-case-curation.ts`  
  承接 solved-case markdown/frontmatter/dirty flag 写入。
- Modify: `src/runtime/case-curator.ts`  
  只保留 runtime 编排、输入判断和调用 knowledge service 的逻辑。
- Modify: `src/runtime/case-review-runtime.ts`  
  移除 `defaultConfig()` 隐式配置读取，改为显式传入配置或 workspace root。
- Modify: `src/agents/output-review.md`
- Modify: `src/agents/registry.json`  
  将 `output-review` 标记为不产出用户可见文本。
- Modify: `docs/technical-architecture.md`  
  同步 embedding/vector 默认值与降级行为。
- Modify: `src/gateway/dto.ts`
- Modify: `src/gateway/routes/session-routes.ts`
- Modify: `src/ui.ts`  
  让 session serialization 默认不拉取 knowledge health；前端需要时显式请求。
- Create: `src/ui/assets.ts`, `src/ui/client-script.ts`, `src/ui/renderers.ts`
- Create: `src/onboarding/draft-service.ts`, `src/onboarding/review-service.ts`, `src/onboarding/publish-service.ts`, `src/onboarding/secret-materializer.ts`
- Create: `src/knowledge/quality/audit.ts`, `src/knowledge/quality/report.ts`, `src/knowledge/quality/gate.ts`
- Create: `src/runtime/events/review-events.ts`, `src/runtime/events/presentation-events.ts`, `src/runtime/events/worker-trace-events.ts`
- Modify: `src/ui.ts`, `src/onboarding/service.ts`, `src/knowledge/quality.ts`, `src/runtime/event-recorder.ts`  
  保留薄 facade 或 owner-level aggregator。
- Modify: `test/module-boundaries.test.mjs`  
  增加禁止新代码使用 deprecated 根级 re-export 的检查。

---

## Task 1: Harden Presentation Against Unsupported Facts

**Files:**
- Modify: `src/runtime/review-presentation.ts`
- Modify: `test/supper-helper.test.mjs`
- Check: `docs/technical-architecture.md:145`
- Check: `src/agents/presentation.md`

- [ ] **Step 1: Write failing test for non-path unsupported fact**

Add a test near the existing Presentation fallback tests in `test/supper-helper.test.mjs`:

```js
test('presentation falls back when model introduces unsupported non-path facts', async () => {
  const result = {
    status: 'concluded',
    summary: '已定位到 API 响应字段缺失。',
    claims: [
      {
        id: 'claim-1',
        type: 'fact',
        text: '接口响应缺少 `sessionKeyExpiredTime` 字段。',
        evidenceIds: ['evidence-1'],
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        source: 'src/gateway/session.ts',
        summary: '序列化结果没有包含 `sessionKeyExpiredTime`。',
      },
    ],
    missingInfo: [],
  };

  const reply = await presentReviewedDiagnosticResult({
    result,
    userGoal: '为什么小程序支付会提示会话过期？',
    modelClient: async () => ({
      answerTarget: '回答原因',
      directAnswer: '原因是接口响应缺少 sessionKeyExpiredTime 字段，并且需要重启服务才能恢复。',
      reply: '原因是接口响应缺少 sessionKeyExpiredTime 字段，并且需要重启服务才能恢复。',
      claimIds: ['claim-1'],
      evidenceIds: ['evidence-1'],
      directAnswerClaimIds: ['claim-1'],
    }),
  });

  assert.match(reply, /接口响应缺少 `?sessionKeyExpiredTime`? 字段/);
  assert.doesNotMatch(reply, /重启服务才能恢复/);
});
```

- [ ] **Step 2: Run targeted test and confirm failure**

Run:

```bash
pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "unsupported non-path facts"
```

Expected before implementation: FAIL because the unsupported phrase from model output is accepted.

- [ ] **Step 3: Introduce evidence-bound text validation**

In `src/runtime/review-presentation.ts`, add a deterministic validator that compares `directAnswer` and the first reply paragraph against selected claim/evidence text. Use a conservative rule:

- allow exact selected claim text or normalized token overlap with selected claim/evidence summaries;
- reject sentences containing material tokens not found in selected claims/evidence;
- keep existing path-specific validation because it catches path redaction and invented paths.

Implementation shape:

```ts
function containsUnsupportedAnswerFacts(
  output: PresentationModelOutput,
  selectedClaims: DiagnosticClaim[],
  selectedEvidence: Evidence[],
): boolean {
  const allowedText = normalizeFactTokens([
    ...selectedClaims.map((claim) => claim.text),
    ...selectedEvidence.map((evidence) => evidence.summary),
    ...selectedEvidence.map((evidence) => evidence.source),
  ].join('\n'));
  const answerText = normalizeFactTokens([
    output.directAnswer,
    firstReplyParagraph(output.reply),
  ].join('\n'));

  return materialAnswerTokens(answerText).some((token) => !allowedText.has(token));
}
```

Then call it after `containsUnreviewedPathFacts(...)`:

```ts
if (containsUnsupportedAnswerFacts(output, selectedClaims, selectedEvidence)) {
  return invalid('Presentation introduced unsupported answer facts.');
}
```

- [ ] **Step 4: Keep fallback deterministic**

If validation fails, existing fallback must use accepted claims/evidence only. Do not ask the model to repair unsupported output in the same request.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "presentation"
```

Expected: all Presentation tests pass, including the new unsupported fact regression.

---

## Task 2: Move Solved-Case File Writes Into Knowledge Module

**Files:**
- Create: `src/knowledge/solved-case-curation.ts`
- Modify: `src/runtime/case-curator.ts`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: Write ownership test**

Add a module-boundary test to `test/module-boundaries.test.mjs`:

```js
test('runtime case curator does not write knowledge files directly', async () => {
  const source = await readFile(new URL('../src/runtime/case-curator.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from 'node:fs'/);
  assert.doesNotMatch(source, /\bwriteFileSync\b/);
  assert.doesNotMatch(source, /\bmkdirSync\b/);
  assert.doesNotMatch(source, /dirtyFlagPath/);
});
```

- [ ] **Step 2: Run boundary test and confirm failure**

Run:

```bash
node --test test/module-boundaries.test.mjs --test-name-pattern "runtime case curator"
```

Expected before implementation: FAIL because `src/runtime/case-curator.ts` imports `node:fs` and writes files.

- [ ] **Step 3: Create knowledge owner service**

Create `src/knowledge/solved-case-curation.ts` with the file-writing responsibilities moved from `src/runtime/case-curator.ts`:

```ts
export interface WriteSolvedCaseInput {
  workspaceRoot: string;
  documentId: string;
  moduleId: string;
  markdown: string;
}

export interface WriteSolvedCaseResult {
  path: string;
}

export function writeSolvedCaseDraft(input: WriteSolvedCaseInput): WriteSolvedCaseResult {
  const targetDir = join(input.workspaceRoot, 'knowledge', 'tickets', 'solved-cases', input.moduleId);
  const targetPath = join(targetDir, `${input.documentId}.md`);
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(join(input.workspaceRoot, 'knowledge', 'indexes'), { recursive: true });
  writeFileSync(targetPath, input.markdown, 'utf8');
  writeFileSync(dirtyFlagPath(input.workspaceRoot), `Solved case ${input.documentId} needs indexing.\n`, 'utf8');
  return { path: targetPath };
}
```

Import `existsSync`, `mkdirSync`, `writeFileSync`, `join`, and `dirtyFlagPath` only in this knowledge file.

- [ ] **Step 4: Make runtime orchestrate only**

In `src/runtime/case-curator.ts`:

- remove `node:fs`, `node:path`, and `dirtyFlagPath` imports;
- keep `buildSolvedCaseMarkdown(...)`, `inferModuleId(...)`, and confirmation logic unless moving them would create a cleaner knowledge API;
- call `writeSolvedCaseDraft(...)`;
- return the path from the knowledge service.

Runtime code shape:

```ts
const { path: targetPath } = writeSolvedCaseDraft({
  workspaceRoot: input.workspaceRoot,
  documentId,
  moduleId,
  markdown: buildSolvedCaseMarkdown(...),
});
```

- [ ] **Step 5: Run solved-case tests**

Run:

```bash
pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "solved case"
node --test test/module-boundaries.test.mjs --test-name-pattern "runtime case curator"
```

Expected: runtime behavior stays the same, boundary test passes.

---

## Task 3: Remove `defaultConfig()` From Case Review Runtime

**Files:**
- Modify: `src/runtime/case-review-runtime.ts`
- Modify callers that invoke `reviewSolvedCase(...)`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: Find all callers**

Run:

```bash
rg -n "reviewSolvedCase\\(" src test
```

Expected: list every caller that must pass either `workspaceRoot` or `config`.

- [ ] **Step 2: Write failing custom-root test**

Add a test that configures a custom knowledge root and calls review without `workspaceRoot`:

```js
test('case review runtime resolves workspace root from injected config', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'super-helper-review-root-'));
  const config = {
    ...defaultConfig(),
    knowledge: {
      ...defaultConfig().knowledge,
      rootDir: workspaceRoot,
    },
  };

  const result = reviewSolvedCase({
    config,
    caseSession: createStoredCaseFixture(),
    workspaceId: 'custom-workspace',
    documentPath: 'kb_case_solved_demo.md',
    action: 'approve',
    reviewer: 'tester',
    notes: 'approved',
    events: createNoopEventRecorder(),
  });

  assert.equal(result.record.reviewer, 'tester');
});
```

- [ ] **Step 3: Change input contract**

In `src/runtime/case-review-runtime.ts`, replace:

```ts
const config = defaultConfig();
const workspaceRoot = input.workspaceRoot ?? resolveKnowledgeWorkspaceRoot(config, input.workspaceId);
```

with:

```ts
const workspaceRoot = input.workspaceRoot ?? resolveKnowledgeWorkspaceRoot(input.config, input.workspaceId);
```

Update `ReviewSolvedCaseInput`:

```ts
config: SuperHelperConfig;
```

- [ ] **Step 4: Update callers**

Every caller must pass the already-loaded config. Do not call `defaultConfig()` inside route/runtime helpers.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
pnpm typecheck
pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "case review"
```

Expected: typecheck and case review tests pass.

---

## Task 4: Fix Output Review Agent Visibility Metadata

**Files:**
- Modify: `src/agents/output-review.md`
- Modify: `src/agents/registry.json`
- Modify: `test/supper-helper.test.mjs` or `test/module-boundaries.test.mjs`

- [ ] **Step 1: Write metadata consistency test**

Add a test that asserts only Presentation may produce final user-visible text in this review chain:

```js
test('output-review agent cannot produce user-facing text', async () => {
  const registry = JSON.parse(await readFile(new URL('../src/agents/registry.json', import.meta.url), 'utf8'));
  const outputReview = registry.agents.find((agent) => agent.id === 'output-review');
  const presentation = registry.agents.find((agent) => agent.id === 'presentation');

  assert.equal(outputReview.mayProduceUserFacingText, false);
  assert.equal(presentation.mayProduceUserFacingText, true);
});
```

- [ ] **Step 2: Update registry**

In `src/agents/registry.json`, set:

```json
"mayProduceUserFacingText": false
```

for `output-review`.

- [ ] **Step 3: Update frontmatter**

In `src/agents/output-review.md`, set:

```yaml
may_produce_user_facing_text: false
```

- [ ] **Step 4: Run docs and agent tests**

Run:

```bash
pnpm lint
node --test test/module-boundaries.test.mjs --test-name-pattern "output-review"
```

Expected: metadata is consistent and docs verification passes.

---

## Task 5: Sync Embedding Defaults In Architecture Docs

**Files:**
- Modify: `docs/technical-architecture.md`
- Check: `src/config.ts`
- Check: `openspec/changes/optimize-local-rag-pipeline/specs/knowledge-diagnosis-hardening/spec.md`

- [ ] **Step 1: Confirm current config default**

Run:

```bash
sed -n '100,155p' src/config.ts
```

Expected: `knowledge.buildVectorIndex` and `embedding.enabled` are enabled by default.

- [ ] **Step 2: Update architecture doc**

In `docs/technical-architecture.md`, replace the stale default-disabled wording with:

```md
默认配置会开启本地向量索引构建和 embedding 检索入口；当没有可用 provider key、provider 不可达或本地索引不存在时，系统必须安全降级到词法/结构化检索，不得阻塞诊断流程。
```

Also state that rerank remains optional unless config explicitly enables it.

- [ ] **Step 3: Run docs verification**

Run:

```bash
pnpm lint
```

Expected: docs verification passes.

---

## Task 6: Make Knowledge Health Explicit In Session Serialization

**Files:**
- Modify: `src/gateway/dto.ts`
- Modify: `src/gateway/routes/session-routes.ts`
- Modify: `src/ui.ts`
- Modify: `test/supper-helper.test.mjs`

- [ ] **Step 1: Write default behavior test**

Add a test for `serializeSession(...)`:

```js
test('session serialization does not include knowledge health by default', async () => {
  const session = createStoredCaseFixture();
  const serialized = await serializeSession(session, {
    config: defaultConfig(),
    workspaceId: 'demo',
  });

  assert.equal(serialized.knowledgeHealth, undefined);
});
```

- [ ] **Step 2: Preserve explicit include behavior**

Add the positive case:

```js
test('session serialization includes knowledge health when explicitly requested', async () => {
  const session = createStoredCaseFixture();
  const serialized = await serializeSession(session, {
    config: defaultConfig(),
    workspaceId: 'demo',
    includeKnowledgeHealth: true,
  });

  assert.ok(serialized.knowledgeHealth);
});
```

- [ ] **Step 3: Change default**

In `src/gateway/dto.ts`, change the condition from implicit include to explicit include:

```ts
if (options.includeKnowledgeHealth === true) {
  serialized.knowledgeHealth = await getKnowledgeHealthSummary(...);
}
```

- [ ] **Step 4: Update route/UI callers**

In route handlers that need health data, pass:

```ts
includeKnowledgeHealth: true
```

In UI session polling/list rendering, keep default false and use the explicit health endpoint or explicit refresh action for knowledge health panels.

- [ ] **Step 5: Run gateway tests**

Run:

```bash
pnpm build && node --test test/supper-helper.test.mjs --test-name-pattern "session serialization|knowledge health"
```

Expected: default session payload is lighter; explicit health behavior remains available.

---

## Task 7: Split Oversized Files Without Changing Behavior

**Files:**
- Modify/Create files listed in File Map.
- Modify: `openspec/changes/harden-runtime-observability-and-deep-query/tasks.md` after implementation evidence is complete.

- [ ] **Step 1: Split `src/runtime/event-recorder.ts` by event family**

Create:

- `src/runtime/events/review-events.ts`
- `src/runtime/events/presentation-events.ts`
- `src/runtime/events/worker-trace-events.ts`

Move only pure event payload builders and recorder methods. Keep `src/runtime/event-recorder.ts` as the owner-level class/facade.

Run:

```bash
pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 2: Split `src/knowledge/quality.ts` by responsibility**

Create:

- `src/knowledge/quality/audit.ts`
- `src/knowledge/quality/report.ts`
- `src/knowledge/quality/gate.ts`

Keep public exports from `src/knowledge/quality.ts` stable.

Run:

```bash
pnpm build && node --test test/*.test.mjs --test-name-pattern "knowledge"
```

Expected: behavior unchanged.

- [ ] **Step 3: Split `src/onboarding/service.ts` into workflow services**

Create:

- `src/onboarding/draft-service.ts`
- `src/onboarding/review-service.ts`
- `src/onboarding/publish-service.ts`
- `src/onboarding/secret-materializer.ts`

Keep `src/onboarding/service.ts` as the public orchestration entrypoint.

Run:

```bash
pnpm build && node --test test/*.test.mjs --test-name-pattern "onboard|setup"
```

Expected: onboarding behavior unchanged.

- [ ] **Step 4: Split `src/ui.ts` static assets and render helpers**

Create:

- `src/ui/assets.ts` for static CSS/HTML shell constants.
- `src/ui/client-script.ts` for browser-side script string.
- `src/ui/renderers.ts` for server-side HTML render helpers.

Keep `src/ui.ts` as the export entrypoint used by gateway/dashboard code.

Run:

```bash
pnpm build
```

Expected: dashboard bundle still builds.

- [ ] **Step 5: Update OpenSpec task evidence**

After all split tasks pass verification, update `openspec/changes/harden-runtime-observability-and-deep-query/tasks.md` items 10.1-10.7 with exact verification commands and status.

---

## Task 8: Guard Deprecated Root Re-Exports

**Files:**
- Modify: `test/module-boundaries.test.mjs`
- Check: `src/model.ts`, `src/storage.ts`, `src/preflight.ts`, `src/model-smoke-test.ts`

- [ ] **Step 1: Add import-ban test**

Add a test that scans `src/` and fails if new source files import deprecated root modules:

```js
test('new source code does not import deprecated root compatibility modules', async () => {
  const files = await listSourceFiles(new URL('../src', import.meta.url));
  const forbidden = [
    '../model.js',
    '../storage.js',
    '../preflight.js',
    './model.js',
    './storage.js',
    './preflight.js',
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const specifier of forbidden) {
      assert.doesNotMatch(source, new RegExp(`from ['"]${escapeRegExp(specifier)}['"]`), `${file.pathname} imports ${specifier}`);
    }
  }
});
```

- [ ] **Step 2: Keep compatibility tests for current public facade**

Do not remove existing tests that verify root deprecated exports still work until the agreed minor-version deletion window.

- [ ] **Step 3: Run boundary tests**

Run:

```bash
node --test test/module-boundaries.test.mjs
```

Expected: existing compatibility remains, new source imports are blocked.

---

## Task 9: Final Verification And Closeout

**Files:**
- Modify: `openspec/changes/harden-runtime-observability-and-deep-query/tasks.md`
- Modify: `openspec/changes/upgrade-hybrid-parent-child-retrieval/tasks.md` only if this work completes listed retrieval tasks.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Expected: all commands pass.

- [ ] **Step 2: Check OpenSpec status**

Run:

```bash
openspec status --change harden-runtime-observability-and-deep-query
openspec status --change upgrade-hybrid-parent-child-retrieval
```

Expected:

- `harden-runtime-observability-and-deep-query` remaining split tasks are complete after Task 7.
- `upgrade-hybrid-parent-child-retrieval` remains unchanged unless real source migration/evaluation work was performed.

- [ ] **Step 3: Review diff for scope**

Run:

```bash
git diff --stat
git diff -- src/runtime src/knowledge src/gateway src/agents docs test openspec
```

Expected: diff only covers the files listed in this plan or direct test/docs updates needed by those files.

- [ ] **Step 4: Commit in reviewable chunks**

Suggested commits:

```bash
git add src/runtime/review-presentation.ts test/supper-helper.test.mjs
git commit -m "fix: reject unsupported presentation facts"

git add src/knowledge/solved-case-curation.ts src/runtime/case-curator.ts test/module-boundaries.test.mjs
git commit -m "refactor: move solved case writes to knowledge module"

git add src/runtime/case-review-runtime.ts test/supper-helper.test.mjs
git commit -m "fix: inject config into case review runtime"

git add src/agents/output-review.md src/agents/registry.json docs/technical-architecture.md
git commit -m "docs: align agent metadata and embedding defaults"

git add src/gateway/dto.ts src/gateway/routes/session-routes.ts src/ui.ts test/supper-helper.test.mjs
git commit -m "refactor: make session knowledge health explicit"

git add src/ui.ts src/ui src/onboarding src/knowledge/quality.ts src/knowledge/quality src/runtime/event-recorder.ts src/runtime/events openspec/changes/harden-runtime-observability-and-deep-query/tasks.md
git commit -m "refactor: split oversized module files"
```

---

## Execution Order

1. Task 1: Presentation unsupported facts.
2. Task 2: solved-case ownership.
3. Task 3: case review config injection.
4. Task 4 and Task 5: metadata/docs consistency.
5. Task 6: explicit session knowledge health.
6. Task 8: deprecated import guard.
7. Task 7: large-file split.
8. Task 9: full verification and OpenSpec closeout.

## Risk Notes

- Task 1 is the highest product-risk item because it protects final answers from unsupported claims.
- Task 2 and Task 3 are boundary correctness issues and should be completed before broad file splits.
- Task 7 has the largest diff risk; execute it only after behavior-changing fixes are green.
- Any API response shape change in Task 6 must remain backward-compatible or be backed by an OpenSpec update before merge.
