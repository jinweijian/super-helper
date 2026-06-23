## ADDED Requirements

### Requirement: Knowledge CLI dispatcher is thin
`command-knowledge.ts` SHALL only select a knowledge subcommand handler, print unknown-command usage and preserve process exit behavior. It MUST remain at or below approximately 120 lines.

#### Scenario: Supported subcommand is invoked
- **WHEN** user invokes init、update、search、pipeline stage or vector build
- **THEN** dispatcher delegates to the corresponding module under `src/cli/knowledge/`
- **AND** command name, flags, output and exit code remain compatible

#### Scenario: Unknown subcommand is invoked
- **WHEN** user invokes an unsupported knowledge subcommand
- **THEN** existing usage text is printed to stderr
- **AND** process exits with code 1

### Requirement: Shared CLI context and output
Workspace/config/path/quality/provider flag interpretation SHALL be centralized in CLI knowledge helpers and MUST NOT be copied into each handler.

#### Scenario: Explicit workspace and knowledge root are supplied
- **WHEN** command includes `--workspace` and `--knowledge-root`
- **THEN** every handler receives the same resolved project and knowledge workspace roots
- **AND** no handler invents a separate storage scope

#### Scenario: Quality gate is invalid
- **WHEN** command receives an invalid `--quality-gate`
- **THEN** existing validation message and exit code are preserved

### Requirement: CLI delegates business behavior
CLI handlers SHALL call knowledge/retrieval/provider service contracts and MUST NOT implement indexing, recall, provider HTTP or runtime decisions.

#### Scenario: Vector build runs
- **WHEN** user runs `knowledge vector build`
- **THEN** CLI creates the provider through `src/providers/embedding` and delegates artifact construction to knowledge
- **AND** safe output excludes raw vectors, documents and credentials
