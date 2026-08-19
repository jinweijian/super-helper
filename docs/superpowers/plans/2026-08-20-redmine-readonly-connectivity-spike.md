# Redmine Readonly Connectivity Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `super helper` 增加安全的 Redmine API Key 本地录入命令和一个固定范围、GET-only 的真实 Redmine 连通性 probe，验证 `itsupportknowledge` 项目、工单列表与单条详情可读。

**Architecture:** CLI 只处理命令分发、隐藏输入和安全文本输出；`FileSecretsRepository` 继续拥有本地密钥持久化；`src/mcp-servers/redmine/redmine-api/` 隔离 Redmine HTTP 协议和 schema；`probe.ts` 编排固定的项目→列表→详情读取并返回不含工单内容的结构化结果。默认测试使用 fake `fetch`，只有显式 `pnpm redmine:probe` 才访问真实 Redmine。

**Tech Stack:** TypeScript 5.8、Node.js 20.19+、Zod 4、Node test runner、原生 `fetch`/`AbortController`、现有 `FileSecretsRepository`。

## Global Constraints

- 所有用户交互、文档和 CLI 输出使用中文或既定安全状态码；代码标识符保持英文。
- 真实 origin 固定为 `https://redmine.codeages.work`，项目 identifier 固定为 `itsupportknowledge`。
- API Key 只能进入 `~/.super-helper/secrets.json` 和 `X-Redmine-API-Key` 请求头；密钥键名固定为 `integrations.redmine.apiKey`。
- 所有 Redmine 请求必须为 GET，`redirect: 'error'`，超时 10 秒，不自动重试。
- 列表必须使用 `status_id=*`、`sort=updated_on:desc`、`limit=1`。
- 详情 issue ID 只能来自同一次列表响应；列表和详情必须复核数值 project ID。
- probe 不输出 issue ID、主题、description、notes、人员、附件名、附件 URL、响应正文、请求头或密钥。
- 不修改 HTTP response shape、Case JSON shape、Runtime、Gateway、Agent 或 Knowledge 行为。
- 默认 `pnpm test` 不联网、不要求真实 Redmine 凭证。
- 每个 TypeScript 行为任务遵循测试先行；完成后运行 `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`。

---

## 文件结构与职责

新增：

```text
src/cli/hidden-input.ts
  只负责从交互式 TTY 隐藏读取一行，不记录或回显内容。

src/cli/command-redmine.ts
  解释 redmine secret set / redmine probe，组合 secrets 与 probe，输出安全状态。

src/mcp-servers/redmine/contracts.ts
  固定 scope、错误码、probe 输入输出合同。

src/mcp-servers/redmine/redmine-api/protocol.ts
  用 Zod 解析项目、列表和详情的最小字段，主动丢弃正文与身份字段。

src/mcp-servers/redmine/redmine-api/error-mapping.ts
  把 HTTP/timeout/transport/schema 错误归一化为固定安全错误码。

src/mcp-servers/redmine/redmine-api/client.ts
  固定 origin、GET-only Redmine HTTP adapter；不读取本地 SecretRef。

src/mcp-servers/redmine/probe.ts
  编排项目→列表→详情，复核范围并生成有界统计结果。

test/redmine-readonly-probe.test.mjs
  离线验证密钥录入、HTTP 合同、范围复核、错误映射和输出脱敏。
```

修改：

```text
src/cli/main.ts
  增加薄 redmine 命令分发和 usage。

package.json
  增加 redmine:secret:set 与 redmine:probe 显式命令别名。

docs/standards/development.md
docs/standards/module-boundaries.md
docs/architecture/overview.md
  声明 src/mcp-servers/redmine 的 ownership 和禁止边界。
```

---

### Task 1: 安全 Redmine 密钥录入命令

**Files:**

- Create: `src/cli/hidden-input.ts`
- Create: `src/cli/command-redmine.ts`
- Modify: `src/cli/main.ts`
- Modify: `package.json`
- Create: `test/redmine-readonly-probe.test.mjs`

**Interfaces:**

- Consumes: `FileSecretsRepository.set(key: string, value: string): SecretRef`；`DEFAULT_HOME`。
- Produces: `REDMINE_API_KEY_SECRET = 'integrations.redmine.apiKey'`；`runRedmineCommand(input): Promise<boolean>`；`readHiddenLine(prompt): Promise<string>`。

- [x] **Step 1: 写密钥命令失败测试**

在 `test/redmine-readonly-probe.test.mjs` 中创建临时目录并直接调用命令边界：

```js
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  REDMINE_API_KEY_SECRET,
  runRedmineCommand,
} from '../dist/cli/command-redmine.js';

test('redmine secret set stores a confirmed hidden value without printing it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-secret-'));
  const writes = [];
  const answers = ['redmine-fixture-secret', 'redmine-fixture-secret'];
  try {
    const ok = await runRedmineCommand({
      argv: ['secret', 'set'],
      rootDir: root,
      readSecret: async () => answers.shift() ?? '',
      write: (line) => writes.push(line),
    });
    const stored = readFileSync(join(root, 'secrets.json'), 'utf8');
    assert.equal(ok, true);
    assert.match(stored, new RegExp(REDMINE_API_KEY_SECRET.replaceAll('.', '\\.')));
    assert.match(stored, /redmine-fixture-secret/);
    assert.equal(statSync(join(root, 'secrets.json')).mode & 0o777, 0o600);
    assert.equal(writes.join('\n').includes('redmine-fixture-secret'), false);
    assert.deepEqual(writes, ['redmine secret: configured']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('redmine secret set rejects empty or mismatched confirmation without overwriting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'super-helper-redmine-secret-'));
  try {
    const emptyLines = [];
    assert.equal(await runRedmineCommand({
      argv: ['secret', 'set'], rootDir: root,
      readSecret: async () => '', write: (line) => emptyLines.push(line),
    }), false);
    assert.deepEqual(emptyLines, ['redmine secret: failed (empty_secret)']);

    const answers = ['first-secret', 'second-secret'];
    const mismatchLines = [];
    assert.equal(await runRedmineCommand({
      argv: ['secret', 'set'], rootDir: root,
      readSecret: async () => answers.shift() ?? '',
      write: (line) => mismatchLines.push(line),
    }), false);
    assert.deepEqual(mismatchLines, ['redmine secret: failed (confirmation_mismatch)']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [x] **Step 2: 构建并运行测试，确认因模块缺失而失败**

Run: `pnpm build && node --test test/redmine-readonly-probe.test.mjs`

Expected: FAIL，错误包含 `Cannot find module '../dist/cli/command-redmine.js'`。

- [x] **Step 3: 实现隐藏输入和最小密钥命令**

`src/cli/hidden-input.ts` 实现交互式 TTY 读取，进入 raw mode 后只接受可打印字符、退格、回车和 Ctrl+C；cleanup 必须恢复原 raw mode、移除 listener 并 pause stdin。固定错误只允许 `interactive_tty_required` 与 `input_cancelled`：

```ts
export async function readHiddenLine(prompt: string): Promise<string>;
```

`src/cli/command-redmine.ts` 首版实现：

```ts
export const REDMINE_API_KEY_SECRET = 'integrations.redmine.apiKey';

export interface RunRedmineCommandInput {
  argv: string[];
  rootDir?: string;
  readSecret?: (prompt: string) => Promise<string>;
  write?: (line: string) => void;
}

export async function runRedmineCommand(input: RunRedmineCommandInput): Promise<boolean> {
  const write = input.write ?? ((line) => console.log(line));
  if (input.argv[0] !== 'secret' || input.argv[1] !== 'set' || input.argv.length !== 2) {
    write('用法: super-helper redmine secret set');
    return false;
  }
  const readSecret = input.readSecret ?? readHiddenLine;
  let first: string;
  let second: string;
  try {
    first = (await readSecret('Redmine API 访问键: ')).trim();
    if (!first) {
      write('redmine secret: failed (empty_secret)');
      return false;
    }
    second = (await readSecret('再次输入 Redmine API 访问键: ')).trim();
  } catch (error) {
    const code = error instanceof Error && ['interactive_tty_required', 'input_cancelled'].includes(error.message)
      ? error.message : 'secret_input_failed';
    write(`redmine secret: failed (${code})`);
    return false;
  }
  if (first !== second) {
    write('redmine secret: failed (confirmation_mismatch)');
    return false;
  }
  new FileSecretsRepository(input.rootDir ?? DEFAULT_HOME).set(REDMINE_API_KEY_SECRET, first);
  write('redmine secret: configured');
  return true;
}
```

在 `src/cli/main.ts` 的复杂子命令分发中加入：

```ts
if (command === 'redmine') {
  const ok = await runRedmineCommand({ argv });
  if (!ok) process.exitCode = 1;
  return;
}
```

更新 usage，并在 `package.json` 增加：

```json
"redmine:secret:set": "pnpm build && node dist/cli.js redmine secret set"
```

- [x] **Step 4: 构建并运行密钥专项测试**

Run: `pnpm build && node --test test/redmine-readonly-probe.test.mjs`

Expected: PASS，2 tests；测试输出不包含 fixture secret。

- [x] **Step 5: 运行类型检查**

Run: `pnpm typecheck`

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add src/cli/hidden-input.ts src/cli/command-redmine.ts src/cli/main.ts package.json test/redmine-readonly-probe.test.mjs
git commit -m "feat: add secure Redmine secret input"
```

---

### Task 2: 固定范围的 GET-only Redmine API adapter

**Files:**

- Create: `src/mcp-servers/redmine/contracts.ts`
- Create: `src/mcp-servers/redmine/redmine-api/protocol.ts`
- Create: `src/mcp-servers/redmine/redmine-api/error-mapping.ts`
- Create: `src/mcp-servers/redmine/redmine-api/client.ts`
- Modify: `test/redmine-readonly-probe.test.mjs`

**Interfaces:**

- Consumes: 运行时已 materialize 的 `apiKey: string` 和可注入 `fetchImpl: typeof fetch`；不得 import secrets、CLI、runtime、gateway。
- Produces: `createRedmineReadonlyClient(options): RedmineReadonlyClient`；安全的 `RedmineProbeErrorCode`；只包含 id/project id/数组数量所需字段的协议类型。

- [x] **Step 1: 写 GET、认证头、固定 URL 和最小 schema 的失败测试**

追加测试，fake `fetch` 依次返回 project、issue list 和 detail fixtures；记录每次 `URL` 与 `RequestInit`，断言：

```js
assert.deepEqual(calls.map((call) => call.url), [
  'https://redmine.codeages.work/projects/itsupportknowledge.json',
  'https://redmine.codeages.work/issues.json?project_id=77&status_id=*&sort=updated_on%3Adesc&limit=1',
  'https://redmine.codeages.work/issues/118740.json?include=journals%2Crelations%2Cattachments',
]);
for (const call of calls) {
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.redirect, 'error');
  assert.equal(new Headers(call.init.headers).get('X-Redmine-API-Key'), 'redmine-fixture-secret');
  assert.equal(JSON.stringify(call).includes('subject fixture'), false);
}
```

project fixture 只需：

```js
{ project: { id: 77, identifier: 'itsupportknowledge' } }
```

列表 fixture 可以携带 `subject`、`description`、`assigned_to` 等诱饵字段，但解析结果必须只保留：

```js
{ issues: [{ id: 118740, project: { id: 77 } }] }
```

详情 fixture 同样携带 notes/附件名诱饵，但解析结果只保留 id、project id 和三个数组的元素数量所需 id。

- [x] **Step 2: 写范围和错误映射失败测试**

覆盖以下表格，并断言错误对象只包含固定 code，不包含原始 body、API Key 或 fixture 文本：

```js
[
  [401, 'authentication_failed'],
  [403, 'project_forbidden'],
  [404, 'project_not_found'],
  [429, 'rate_limited'],
  [500, 'service_unavailable'],
]
```

另测：项目 identifier 不一致、列表 project ID 不一致、详情 project ID 不一致、非法 JSON、schema 缺字段、AbortError、跨 origin Location/redirect 响应。

- [x] **Step 3: 构建并运行测试，确认因 API 模块缺失而失败**

Run: `pnpm build && node --test test/redmine-readonly-probe.test.mjs`

Expected: FAIL，错误指向 `dist/mcp-servers/redmine/...` 模块缺失或导出缺失。

- [x] **Step 4: 定义稳定合同与最小协议 schema**

`contracts.ts` 定义：

```ts
export const REDMINE_ORIGIN = 'https://redmine.codeages.work';
export const REDMINE_PROJECT_IDENTIFIER = 'itsupportknowledge';
export const REDMINE_TIMEOUT_MS = 10_000;

export type RedmineProbeErrorCode =
  | 'missing_credentials'
  | 'authentication_failed'
  | 'project_forbidden'
  | 'project_not_found'
  | 'project_scope_mismatch'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_response'
  | 'service_unavailable';

export interface RedmineReadonlyClient {
  getProject(): Promise<{ id: number; identifier: string }>;
  listLatestIssue(projectId: number): Promise<Array<{ id: number; projectId: number }>>;
  getIssueDetail(issueId: number, expectedProjectId: number): Promise<{
    projectId: number;
    journalCount: number;
    relationCount: number;
    attachmentCount: number;
  }>;
}
```

`protocol.ts` 使用严格的正整数 schema；Zod object 默认 strip 未声明字段：

```ts
export const ProjectResponseSchema = z.object({
  project: z.object({ id: z.number().int().positive(), identifier: z.string().min(1) }),
});
export const IssuesResponseSchema = z.object({
  issues: z.array(z.object({
    id: z.number().int().positive(),
    project: z.object({ id: z.number().int().positive() }),
  })),
});
export const IssueResponseSchema = z.object({
  issue: z.object({
    id: z.number().int().positive(),
    project: z.object({ id: z.number().int().positive() }),
    journals: z.array(z.object({ id: z.number().int().positive() })).optional().default([]),
    relations: z.array(z.object({ id: z.number().int().positive() })).optional().default([]),
    attachments: z.array(z.object({ id: z.number().int().positive() })).optional().default([]),
  }),
});
```

- [x] **Step 5: 实现安全错误和 GET-only client**

`error-mapping.ts` 暴露只包含 code 的错误：

```ts
export class RedmineProbeError extends Error {
  constructor(readonly code: RedmineProbeErrorCode) {
    super(code);
    this.name = 'RedmineProbeError';
  }
}
export function codeForStatus(status: number, operation: 'project' | 'issues' | 'detail'): RedmineProbeErrorCode;
```

`client.ts` 的唯一构造入口：

```ts
export function createRedmineReadonlyClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): RedmineReadonlyClient;
```

内部 `request(pathname, query, schema)` 必须：

- 从 `REDMINE_ORIGIN` 构造 URL，并再次断言 `url.origin === REDMINE_ORIGIN`。
- 设置 `method: 'GET'`、`redirect: 'error'`、`Accept: application/json` 和 `X-Redmine-API-Key`。
- 使用 `AbortController` 与 10 秒 timer。
- HTTP 非 2xx 时不读取 response body，直接按 status/operation 抛安全错误。
- `response.json()` 或 schema parse 失败统一为 `invalid_response`，不保留原始异常消息。
- `AbortError` 映射 `timeout`，其余 fetch 异常映射 `service_unavailable`。
- `getProject()` 复核 identifier；列表与详情复核数值 project ID。

- [x] **Step 6: 构建并运行专项测试**

Run: `pnpm build && node --test test/redmine-readonly-probe.test.mjs`

Expected: PASS；所有请求均为固定 origin GET，错误输出不含诱饵敏感字段。

- [x] **Step 7: 运行类型检查并提交**

Run: `pnpm typecheck`

Expected: PASS。

```bash
git add src/mcp-servers/redmine test/redmine-readonly-probe.test.mjs
git commit -m "feat: add readonly Redmine API client"
```

---

### Task 3: Probe 编排、安全 CLI 输出和显式真实命令

**Files:**

- Create: `src/mcp-servers/redmine/probe.ts`
- Modify: `src/cli/command-redmine.ts`
- Modify: `src/cli/main.ts`
- Modify: `package.json`
- Modify: `test/redmine-readonly-probe.test.mjs`

**Interfaces:**

- Consumes: `createRedmineReadonlyClient`、`FileSecretsRepository.resolve({ source: 'file', key })`。
- Produces: `runRedmineReadonlyProbe(input): Promise<RedmineProbeResult>`；CLI `redmine probe`；package script `redmine:probe`。

- [x] **Step 1: 写成功、无工单和缺密钥失败测试**

成功结果必须精确为：

```js
{
  ok: true,
  project: { identifier: 'itsupportknowledge', numericId: 77 },
  issueList: { sampleCount: 1, includesAllStatuses: true },
  issueDetail: { status: 'ok', journalCount: 2, relationCount: 1, attachmentCount: 1 },
}
```

无工单结果必须保持成功并返回：

```js
issueDetail: { status: 'skipped_no_issue', journalCount: 0, relationCount: 0, attachmentCount: 0 }
```

CLI 缺少密钥时只输出：

```text
redmine readonly probe: failed (missing_credentials)
请先执行: super-helper redmine secret set
```

且 `fetchImpl` 调用次数为 0。

- [x] **Step 2: 写完整输出脱敏失败测试**

用包含以下诱饵的 fixture：

```js
{
  apiKey: 'redmine-fixture-secret',
  issueId: 118740,
  subject: 'subject fixture',
  description: 'description fixture',
  notes: 'private note fixture',
  author: { name: 'Fixture Person', mail: 'person@example.test' },
  attachment: { filename: 'secret.pdf', content_url: 'https://redmine.example/secret.pdf' },
}
```

断言 CLI 所有行连接后不包含任何诱饵值，只包含固定 identifier、numeric project ID、数量和状态。

- [x] **Step 3: 构建并运行测试，确认 probe 缺失而失败**

Run: `pnpm build && node --test test/redmine-readonly-probe.test.mjs`

Expected: FAIL，错误指向 `runRedmineReadonlyProbe` 或 `redmine probe` 尚未实现。

- [x] **Step 4: 实现无内容 probe result**

`probe.ts` 定义并实现：

```ts
export type RedmineProbeResult =
  | {
      ok: true;
      project: { identifier: typeof REDMINE_PROJECT_IDENTIFIER; numericId: number };
      issueList: { sampleCount: 0 | 1; includesAllStatuses: true };
      issueDetail: {
        status: 'ok' | 'skipped_no_issue';
        journalCount: number;
        relationCount: number;
        attachmentCount: number;
      };
    }
  | { ok: false; code: RedmineProbeErrorCode };

export async function runRedmineReadonlyProbe(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<RedmineProbeResult>;
```

编排只允许：`getProject()` → `listLatestIssue(project.id)` → 对数组第一项执行 `getIssueDetail(issue.id, project.id)`。捕获 `RedmineProbeError` 时只返回其 code；未知错误返回 `service_unavailable`。

- [x] **Step 5: 扩展 CLI probe 分支**

扩展 `RunRedmineCommandInput`：

```ts
fetchImpl?: typeof fetch;
probe?: typeof runRedmineReadonlyProbe;
```

`argv` 精确为 `['probe']` 时：

1. 从 `FileSecretsRepository` 解析固定 file SecretRef。
2. 缺失时输出固定两行并返回 false。
3. 调用 probe，不把 API Key 传给 write/logger。
4. 成功时输出项目、列表和详情计数；失败时仅输出 code。

更新 `package.json`：

```json
"redmine:probe": "pnpm build && node dist/cli.js redmine probe"
```

usage 增加 `redmine <secret set|probe>`。

- [x] **Step 6: 构建并运行专项测试**

Run: `pnpm build && node --test test/redmine-readonly-probe.test.mjs`

Expected: PASS；测试进程无网络访问。

- [x] **Step 7: 运行 CLI 缺密钥验收**

使用隔离 home 通过直接调用 `runRedmineCommand({ argv: ['probe'], rootDir: tempDir })` 验证，不能操作真实 `~/.super-helper`。

Expected: `missing_credentials`，无 fetch 调用。

- [x] **Step 8: 运行类型检查并提交**

Run: `pnpm typecheck`

Expected: PASS。

```bash
git add src/mcp-servers/redmine/probe.ts src/cli/command-redmine.ts src/cli/main.ts package.json test/redmine-readonly-probe.test.mjs
git commit -m "feat: add Redmine readonly connectivity probe"
```

---

### Task 4: 固化模块边界、文档与全量离线验证

**Files:**

- Modify: `docs/standards/development.md`
- Modify: `docs/standards/module-boundaries.md`
- Modify: `docs/architecture/overview.md`
- Modify: `test/redmine-readonly-probe.test.mjs`

**Interfaces:**

- Consumes: Tasks 1–3 的目录与命令。
- Produces: 可审计 ownership 文档、离线验收证据和真实穿刺操作说明。

- [x] **Step 1: 增加模块边界结构测试**

测试读取三个文档和关键源码，至少断言：

```js
assert.match(development, /src\/mcp-servers\/redmine/);
assert.match(boundaries, /Redmine REST 协议/);
assert.match(overview, /Redmine 只读连通性/);
assert.doesNotMatch(clientSource, /FileSecretsRepository|src\/cli|src\/runtime|src\/gateway/);
assert.doesNotMatch(commandSource, /X-Redmine-API-Key|\/issues\.json|\/projects\//);
```

- [x] **Step 2: 运行专项测试，确认文档声明缺失而失败**

Run: `pnpm build && node --test test/redmine-readonly-probe.test.mjs`

Expected: FAIL，三个 ownership 文档尚未包含新边界。

- [x] **Step 3: 更新 ownership 文档**

在 `development.md` 的 ownership map 增加：

```text
src/mcp-servers/redmine/ | Redmine REST 协议、严格响应 schema、只读 probe、未来 MCP server tools/transports | Runtime 编排、AnswerGoal、Evidence Review、最终回复、SecretRef 文件读取
```

在 `module-boundaries.md` 声明：

- `src/mcp/` 是通用 MCP Client。
- `src/mcp-servers/redmine/` 是独立外部系统 adapter/server 边界。
- API adapter 只接收 materialized credential，不读 secrets 文件。
- CLI 只负责 SecretRef materialize、命令组合和安全输出。
- 当前穿刺固定单一 origin/project，不是任意 HTTP 客户端。

在 `overview.md` 增加“Redmine 只读连通性穿刺”小节，明确它尚未进入 Runtime 答案来源链路。

- [x] **Step 4: 运行专项测试和 docs lint**

Run: `pnpm build && node --test test/redmine-readonly-probe.test.mjs && pnpm lint`

Expected: PASS。

- [x] **Step 5: 运行完整验证**

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm build`

Expected: PASS。

Run: `pnpm test`

Expected: PASS；不得访问真实 Redmine。

- [x] **Step 6: 运行泄漏扫描**

Run:

```bash
rg -n "redmine-fixture-secret|private note fixture|person@example\.test|secret\.pdf" src docs package.json \
  --glob '!docs/superpowers/plans/2026-08-20-redmine-readonly-connectivity-spike.md'
```

Expected: 无输出。专项测试和本实施计划可以包含诱饵，但生产源码、产品文档和 package 配置不得包含。

- [x] **Step 7: 提交离线实现收尾**

```bash
git add docs/standards/development.md docs/standards/module-boundaries.md docs/architecture/overview.md test/redmine-readonly-probe.test.mjs
git commit -m "docs: define Redmine readonly adapter boundary"
```

---

### Task 5: 用户密钥录入与真实只读穿刺

**Files:**

- Runtime local secret only: `~/.super-helper/secrets.json`（不加入 Git、不读取到工具输出）

**Interfaces:**

- Consumes: `redmine:secret:set` 与 `redmine:probe`。
- Produces: 真实环境的安全状态结果；不产生仓库文件变更。

- [x] **Step 1: 请用户在自己的终端隐式录入密钥**

Run:

```bash
pnpm redmine:secret:set
```

Expected: 终端连续两次隐藏输入后只显示 `redmine secret: configured`。用户不得把密钥粘贴到聊天。

- [x] **Step 2: 只检查 SecretRef 是否存在和文件权限，不输出文件内容**

通过 `FileSecretsRepository.has({ source: 'file', key: 'integrations.redmine.apiKey' })` 和文件 stat 执行只返回布尔值/权限位的检查。

Expected: `configured=true`，mode 为 `0600`；不得执行 `cat ~/.super-helper/secrets.json`。

- [x] **Step 3: 执行真实只读穿刺**

Run:

```bash
pnpm redmine:probe
```

Expected 成功输出：

```text
redmine authentication: ok
redmine project: ok (identifier=itsupportknowledge, numericId=<number>)
redmine issue list: ok (sampleCount=1, includesAllStatuses=true)
redmine issue detail: ok (journals=<number>, relations=<number>, attachments=<number>)
redmine readonly probe: passed
```

若失败，只记录安全错误码并按 `authentication_failed`、`project_forbidden`、`project_not_found`、`rate_limited`、`timeout`、`invalid_response` 或 `service_unavailable` 定位；不得打印原始响应或密钥。

- [x] **Step 4: 检查工作区和 Git 历史无密钥变更**

Run: `git status --short`

Expected: 无由真实穿刺产生的仓库文件变更。

- [x] **Step 5: 更新本计划 checklist 并提交验证记录（不包含真实值）**

只把完成的 checkbox 改为 `[x]`；不得记录 numeric project ID、issue 数量之外的任何真实工单信息，也不得记录 API Key。

```bash
git add docs/superpowers/plans/2026-08-20-redmine-readonly-connectivity-spike.md
git commit -m "test: verify Redmine readonly connectivity"
```

---

## 自审结果

- 规格覆盖：密钥存储、隐藏录入、固定 origin/project、GET-only、列表与详情、范围复核、错误映射、脱敏、离线测试、真实显式 probe 均有对应任务。
- 范围：只实现底层连通性穿刺，不实现 MCP tools、Runtime、UI、相似度或写操作。
- 类型一致性：CLI、client 和 probe 的函数名、错误码和 result 字段在各任务中保持一致。
- 占位符：计划不包含未决占位、模糊处理要求或未定义接口。
