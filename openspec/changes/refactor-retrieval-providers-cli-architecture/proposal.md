## Why

The current codebase does not make the retrieval business flow visible from the directory structure: keyword/RAG/vector/rerank orchestration is mixed into `knowledge`, provider adapters are grouped under `embedding`, and CLI command behavior is still concentrated in the large `src/cli.ts` entrypoint. This makes it hard to add or remove recall strategies such as BM25, embedding recall, future business recall, or rerank providers without reopening unrelated modules.

## What Changes

- Introduce a first-class `retrieval` module that owns multi-strategy recall, candidate fusion, optional rerank, and retrieval traces.
- Treat BM25 and embedding recall as sibling `RecallStrategy` implementations, with registry-based enablement so future recall strategies can be added or removed without changing runtime flow.
- Split provider capabilities into sibling `providers/embedding` and `providers/rerank` modules, with adapter, protocol, factory, smoke test, error, redaction, and HTTP helper boundaries visible in the directory tree.
- Keep `knowledge` focused on local knowledge assets, pipeline stages, taxonomy, health, and local index artifacts; it must not import provider factories or own RAG orchestration.
- Refactor CLI into `cli/main.ts` plus `cli/command-*` files so command parsing/output is separate from knowledge, retrieval, provider, config, server, and acceptance behavior.
- Preserve public HTTP response shapes, CLI command names and output semantics, config shape, case JSON shape, and knowledge artifact compatibility.
- Add module-boundary tests and architecture documentation so future changes can see and enforce the intended hierarchy.

## Capabilities

### New Capabilities
- `multi-strategy-retrieval`: Defines pluggable recall strategies, BM25 and embedding recall, candidate fusion, optional rerank, and retrieval trace behavior.
- `provider-adapter-boundaries`: Defines provider capability layering for embedding and rerank as sibling modules with visible factory, adapter, protocol, smoke test, and safe error boundaries.
- `cli-command-boundaries`: Defines CLI command module ownership, `command-*` file naming, dispatcher constraints, and delegation to service modules.

### Modified Capabilities
- `knowledge-diagnosis-hardening`: Knowledge-first runtime keeps existing evidence-review behavior but consumes evidence from the new retrieval service instead of RAG orchestration inside `knowledge`.

## Impact

- Affected modules: `src/knowledge/`, `src/retrieval/`, `src/providers/`, `src/embedding/`, `src/runtime/`, `src/cli/`, `src/gateway/`, and architecture docs.
- New directories: `src/retrieval/`, `src/providers/`, and additional `src/cli/command-*` files.
- Compatibility exports remain for existing imports from `src/embedding/index.ts`, `src/knowledge/index.ts`, and `src/cli.ts` during the first migration.
- Tests will be added for retrieval behavior, provider boundaries, CLI command routing, and import-boundary regression checks.
