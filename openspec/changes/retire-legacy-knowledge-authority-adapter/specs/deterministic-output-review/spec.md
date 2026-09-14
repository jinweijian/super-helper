## MODIFIED Requirements

### Requirement: Output review validates safety and structure
Output review MUST validate structure, source binding, workspace scope, semantic labels, and sensitive information. It MUST NOT replace a usable authority conclusion with a generic evidence-insufficient response.

#### Scenario: Authority conclusion is structurally valid
- **WHEN** claims and evidence are valid and safe
- **THEN** the presentation includes the authority conclusion and supporting basis

#### Scenario: Authority result is incomplete
- **WHEN** the result is missing required structure or contains unsafe content
- **THEN** only the invalid content is removed or the run is safely downgraded, with no invented technical conclusion
