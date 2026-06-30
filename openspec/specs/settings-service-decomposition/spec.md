## Purpose

Define the settings service decomposition that splits configuration, settings persistence, and settings presentation into independent, testable units.

## Requirements

### Requirement: Settings responsibilities are separated
Settings input contracts、public response mapping、secret application、model settings、embedding/rerank settings and Claude settings SHALL live in focused modules. `src/settings/service.ts` SHALL contain compatibility re-exports only and remain at or below approximately 120 lines.

#### Scenario: Gateway imports settings service
- **WHEN** existing routes import public、update or test functions from `settings/service.ts`
- **THEN** the same names and compatible signatures remain available
- **AND** the facade delegates to the owning implementation modules

#### Scenario: Boundary test scans implementation imports
- **WHEN** architecture tests inspect settings modules
- **THEN** implementation modules do not import the compatibility facade
- **AND** DTO contracts and secret helpers are not redeclared in provider-specific files

### Requirement: Settings API behavior remains compatible
Settings decomposition MUST preserve public response fields、config mutation、SecretRef storage、secret redaction、provider defaults and smoke-test status/body behavior.

#### Scenario: Caller submits a plaintext API key
- **WHEN** model、embedding or rerank settings are updated with `apiKey`
- **THEN** the secret store receives the same stable key
- **AND** public settings expose only `hasApiKey`, never plaintext

#### Scenario: Caller updates or tests settings
- **WHEN** gateway updates/tests model、embedding、rerank or Claude settings
- **THEN** HTTP-compatible output and error behavior remain unchanged
- **AND** default automated tests require no network or real credential
