## Purpose

Define the legacy embedding import boundary that prevents knowledge code from importing removed or legacy embedding adapter paths.

## Requirements

### Requirement: Production modules import providers directly
All production TypeScript outside `src/embedding/` SHALL import embedding/rerank contracts, factories, smoke tests and error helpers from `src/providers/`. The old embedding directory SHALL only support compatibility consumers.

#### Scenario: Source import audit runs
- **WHEN** module-boundary tests scan production `src/**/*.ts` excluding `src/embedding/`
- **THEN** no import resolves to the legacy embedding directory

#### Scenario: Config and onboarding use provider contracts
- **WHEN** config, onboarding, CLI or model smoke code consumes embedding/rerank capability
- **THEN** it imports the owning provider contract or helper directly
- **AND** behavior and stored config remain unchanged

### Requirement: Legacy imports remain source compatible
Existing consumers that intentionally import `src/embedding/index.ts` SHALL continue to compile and receive the same public symbols.

#### Scenario: Compatibility tests use old imports
- **WHEN** legacy embedding and vector tests import from the old facade
- **THEN** fake/SiliconFlow/provider metadata and safe error behavior remain compatible

### Requirement: Default operation remains offline and private
Import migration and CLI decomposition MUST NOT introduce network calls, paid usage or secret/raw document logging in default commands and tests.

#### Scenario: Full test suite runs without credentials
- **WHEN** `pnpm test` executes in a clean environment
- **THEN** no real embedding or rerank request is made
- **AND** fixtures and output contain no real secret, raw vector dump or complete sensitive document
