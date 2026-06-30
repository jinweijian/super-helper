## ADDED Requirements

### Requirement: CLI entrypoint is thin
The system SHALL keep the root CLI entrypoint as a thin executable wrapper that delegates to the CLI module.

#### Scenario: Root CLI is inspected
- **WHEN** `src/cli.ts` is inspected
- **THEN** it contains the shebang compatibility entry and delegates command execution to `src/cli/main.ts`

#### Scenario: Root CLI does not import business modules
- **WHEN** `src/cli.ts` imports are inspected
- **THEN** it does not directly import knowledge, retrieval, provider, runtime, gateway, or onboarding implementation modules

### Requirement: CLI command files use command prefix
The system SHALL name CLI command adapter files with the `command-*` prefix so command files group together and are visibly CLI-owned.

#### Scenario: Command files are listed
- **WHEN** `src/cli/` is listed
- **THEN** server, status, doctor, knowledge, retrieval, provider, config, and accept command adapters use names such as `command-knowledge.ts`

#### Scenario: New CLI command is added
- **WHEN** a new complex CLI command is introduced
- **THEN** it is implemented in a new `src/cli/command-<name>.ts` file or in a focused service module that the command adapter calls

### Requirement: CLI command adapters delegate business behavior
CLI command adapters SHALL parse arguments, call the owning service module, print user-readable output, and set process exit behavior; they MUST NOT own provider protocols, retrieval strategy, knowledge pipeline internals, or runtime diagnosis decisions.

#### Scenario: Knowledge command delegates
- **WHEN** `super-helper knowledge ...` runs
- **THEN** `command-knowledge.ts` calls knowledge service APIs and does not directly implement pipeline internals

#### Scenario: Retrieval command delegates
- **WHEN** `super-helper retrieval search` or `super-helper retrieval debug` runs
- **THEN** `command-retrieval.ts` calls retrieval service APIs and prints retrieval result or trace output

#### Scenario: Provider command delegates
- **WHEN** `super-helper embedding test` or `super-helper rerank test` runs
- **THEN** `command-provider.ts` calls the corresponding provider smoke test and prints only safe summary output

#### Scenario: Config command delegates
- **WHEN** `super-helper init`, `model set`, `workspace set`, or `mcp add` runs
- **THEN** `command-config.ts` updates configuration through config-owned helpers and does not call retrieval or provider protocols

### Requirement: CLI compatibility is preserved
The system SHALL preserve existing command names, flags, exit code semantics, and user-visible output meaning during the refactor.

#### Scenario: Existing command still works
- **WHEN** an existing CLI command such as `knowledge update`, `embedding test`, `rerank test`, `dashboard`, `status`, or `doctor` is invoked
- **THEN** it remains available with compatible flags and equivalent output semantics

#### Scenario: Retrieval command is additive
- **WHEN** `super-helper retrieval search` or `super-helper retrieval debug` is added
- **THEN** existing `knowledge search` remains available as a compatibility command

