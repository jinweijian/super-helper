## Context

`super helper` already has strong module-boundary rules, but the current directory layout still hides important business flow. Retrieval behavior is implemented partly in `src/knowledge/indexer.ts`, runtime creates embedding/rerank providers directly, rerank provider code lives under the embedding module, and `src/cli.ts` still contains many command implementations.

The desired architecture must make the flow visible from the tree:

```text
knowledge assets -> multi-strategy retrieval -> evidence judge/runtime
provider adapters -> retrieval strategies
cli commands -> service modules
```

The refactor must preserve existing public behavior while moving ownership to the correct modules. It must not change HTTP response shape, config shape, case JSON shape, or knowledge artifact compatibility.

## Goals / Non-Goals

**Goals:**

- Introduce `src/retrieval/` as the only owner of multi-strategy recall, candidate fusion, optional rerank, and retrieval tracing.
- Represent BM25 and embedding recall as sibling recall strategies under `retrieval/recall/`.
- Introduce `src/providers/embedding/` and `src/providers/rerank/` as sibling provider capability modules.
- Keep `src/knowledge/` focused on local knowledge assets, pipeline stages, taxonomy, health, and local index artifacts.
- Refactor CLI internals into `src/cli/main.ts` and `src/cli/command-*` files without changing user-visible commands.
- Add boundary tests and docs so future modules know where new recall strategies, provider adapters, and CLI commands belong.

**Non-Goals:**

- Do not change existing API response fields.
- Do not change persisted case JSON or knowledge artifact file formats unless a later migration explicitly does so.
- Do not add external vector databases, GraphRAG, or new paid provider calls by default.
- Do not redesign the browser UI beyond imports required by CLI/server wiring.

## Decisions

### Decision 1: Make `retrieval` the business-flow owner

`src/retrieval/` will own recall orchestration and expose a runtime-facing service:

```text
src/retrieval/
  service.ts
  types.ts
  registry.ts
  recall/
    contract.ts
    bm25/
      strategy.ts
      scorer.ts
      tokenizer.ts
    embedding/
      strategy.ts
      vector-search.ts
    keyword/
      strategy.ts
  fusion/
    rrf.ts
    dedupe.ts
    normalize.ts
  rerank/
    service.ts
  evidence-pack.ts
  trace.ts
  index.ts
```

Rationale: retrieval is the business process that combines recall routes. Keeping it outside `knowledge` makes BM25, embedding recall, and future recall strategies visible and replaceable.

Alternative considered: keep RAG in `knowledge/indexer.ts` and only split helper files. Rejected because it still hides the multi-route retrieval workflow inside the knowledge asset module.

### Decision 2: Recall strategies are registered, not hardcoded

Each recall route implements a stable contract:

```ts
export interface RecallStrategy {
  id: string;
  kind: 'lexical' | 'semantic' | 'business' | 'hybrid';
  enabled(context: RetrievalContext): boolean;
  recall(input: RecallInput): Promise<RecallResult>;
}
```

`retrieval/registry.ts` registers default strategies:

- `bm25`: default lexical recall.
- `embedding`: enabled only when embedding is configured and compatible vector artifacts exist.
- `keyword`: compatibility strategy during migration, removable after BM25 parity.

Rationale: adding or deleting recall routes should require only a new `retrieval/recall/<strategy>/` implementation and registry change, not edits to runtime.

Alternative considered: use a single retrieval function with branch logic. Rejected because each new strategy would expand the main function and recreate the current coupling.

### Decision 3: BM25 is sibling to embedding recall

BM25 will live under `retrieval/recall/bm25/`, not under `knowledge/indexes/` or `embedding`.

`knowledge/indexes/bm25-index.ts` may read/write local BM25 artifacts, but `retrieval/recall/bm25/strategy.ts` owns scoring and recall behavior.

Rationale: BM25 is a retrieval strategy. The artifact can belong to `knowledge`, but the recall decision and scoring flow belong to `retrieval`.

### Decision 4: Providers become sibling capability modules

Provider code moves from `src/embedding/` to `src/providers/`:

```text
src/providers/
  errors.ts
  redaction.ts
  http.ts
  embedding/
    contract.ts
    factory.ts
    smoke-test.ts
    fake.ts
    siliconflow/
      adapter.ts
      protocol.ts
      endpoint.ts
  rerank/
    contract.ts
    factory.ts
    smoke-test.ts
    fake.ts
    siliconflow/
      adapter.ts
      protocol.ts
      endpoint.ts
```

Rationale: embedding and rerank are sibling provider capabilities. Rerank is not part of embedding. Shared provider primitives are placed directly at `providers/` rather than in a generic `shared/` directory.

Alternative considered: keep `embedding` as the provider module for both embedding and rerank. Rejected because it contradicts the business boundary and hides rerank as a subordinate concern.

### Decision 5: CLI command files use `command-*`

CLI internals will use prefix naming:

```text
src/cli/
  main.ts
  args.ts
  output.ts
  command-server.ts
  command-status.ts
  command-doctor.ts
  command-knowledge.ts
  command-retrieval.ts
  command-provider.ts
  command-config.ts
  command-accept.ts
  index.ts
```

`src/cli.ts` remains a thin shebang compatibility entry that calls `cli/main.ts`.

Rationale: command files should group together in directory listings and should read as CLI adapters, not business modules.

### Decision 6: Runtime depends on retrieval service, not provider factories

`runtime/knowledge-diagnosis.ts` will call `RetrievalService.retrieve()`. Runtime will not create embedding or rerank providers directly. Provider construction happens behind retrieval strategy setup and provider factories.

Rationale: runtime decides whether evidence is sufficient and how to proceed, not how recall routes are implemented.

## Risks / Trade-offs

- [Risk] Moving files could break many imports while behavior remains unchanged. -> Mitigation: keep compatibility exports in `src/embedding/index.ts`, `src/knowledge/index.ts`, and `src/cli.ts` during the first migration.
- [Risk] BM25 parity may change ranking compared with current keyword scoring. -> Mitigation: keep `retrieval/recall/keyword` as a compatibility strategy until BM25 tests prove expected ranking.
- [Risk] Provider split may duplicate safe error/redaction helpers. -> Mitigation: place common provider primitives directly under `src/providers/` and add boundary tests.
- [Risk] CLI refactor may accidentally change command output. -> Mitigation: add command-level tests before moving implementation code.
- [Risk] Runtime retrieval behavior could drift while extraction happens. -> Mitigation: add retrieval service tests and preserve existing knowledge-first runtime tests.

## Migration Plan

1. Add `src/providers/` and compatibility exports while leaving existing behavior intact.
2. Move embedding/rerank provider contracts, factories, smoke tests, and adapters into sibling provider modules.
3. Add `src/retrieval/` contracts, registry, fusion helpers, and compatibility keyword strategy.
4. Move current vector recall and rerank orchestration out of `knowledge/indexer.ts` into retrieval strategies and `retrieval/rerank/service.ts`.
5. Add BM25 artifact helpers under `knowledge/indexes/` and BM25 recall under `retrieval/recall/bm25/`.
6. Update runtime to call `RetrievalService.retrieve()` through `runtime/knowledge-diagnosis.ts`.
7. Split `src/cli.ts` into `src/cli/main.ts` and `src/cli/command-*` files.
8. Update docs and add module-boundary tests.

Rollback strategy: each migration step keeps compatibility exports. If a step fails, revert that extraction group while keeping prior completed groups that still pass tests.

## Open Questions

- None for the first migration. Public configuration for enabling/disabling individual recall strategies can be introduced later if product requirements need user-facing controls.
