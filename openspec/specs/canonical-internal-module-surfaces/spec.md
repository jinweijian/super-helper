## Purpose

Define the canonical internal module surfaces that downstream modules consume, replacing legacy compatibility shims with one explicit public surface per module.

## Requirements

### Requirement: Every private capability has one canonical source path
The repository SHALL expose each private capability through exactly one documented owner module and MUST NOT retain historical directories、root aliases or alias-only CLI files.

#### Scenario: Embedding and rerank are imported
- **WHEN** production code or tests need embedding/rerank contracts、factories、adapters or smoke tests
- **THEN** they import `src/providers/embedding/` or `src/providers/rerank/`
- **AND** `src/embedding/` does not exist or reappear in generated declarations

#### Scenario: Runtime, worker and server are composed
- **WHEN** gateway、CLI or tests create the runtime、DiagnosticWorker、Claude adapter or HTTP server
- **THEN** they import the owner modules directly
- **AND** `src/agent.ts`、`src/server.ts`、`src/claude-worker.ts` and root `src/index.ts` are absent

#### Scenario: CLI command adapters are imported
- **WHEN** the CLI dispatches doctor、status or server commands
- **THEN** it imports `command-*` modules directly
- **AND** `doctor-command.ts`、`server-commands.ts` and `status-command.ts` are absent

### Requirement: Filesystem and dependency gates prevent alias regression
Architecture tests SHALL scan source、tests、dynamic imports、barrel exports、package metadata and generated declarations for forbidden paths/symbols. The gate MUST fail when a deleted alias or competing canonical path is reintroduced.

#### Scenario: Repository boundary scan runs
- **WHEN** module-boundary tests inspect the working tree and built output
- **THEN** all deleted files/symbols/imports are absent
- **AND** production dependency direction remains gateway/CLI -> runtime/services -> ports/adapters

### Requirement: Remaining facades are declared canonical APIs
`src/cli.ts`、module `index.ts` files and `settings/service.ts` SHALL remain only when they are the current single application/module entry and contain no duplicate implementation or deprecated re-export.

#### Scenario: Canonical facade is reviewed
- **WHEN** an entry facade or barrel is added or changed
- **THEN** its owner、current production callers and exported responsibility are documented
- **AND** there is no second historical path for the same capability

#### Scenario: CLI executable starts
- **WHEN** package bin executes `dist/cli.js`
- **THEN** `src/cli.ts` delegates only to `src/cli/main.ts`
- **AND** current dashboard、onboarding、provider、retrieval and knowledge-pipeline commands remain reachable
