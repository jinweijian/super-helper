## ADDED Requirements

### Requirement: Redmine MCP SHALL be an independent stdio read-only server
The system SHALL provide a standalone stdio MCP server that exposes exactly two historical-case read tools and does not import runtime, gateway, worker, session, or knowledge orchestration.

#### Scenario: Server starts with valid configuration
- **WHEN** `super-helper-redmine-mcp` starts with a materialized API Key
- **THEN** it SHALL expose `redmine_search_issues` and `redmine_get_issue_case_details`
- **AND** no other Redmine tool SHALL be discoverable

#### Scenario: API Key is missing
- **WHEN** the server starts without the required materialized key
- **THEN** it SHALL fail with a stable safe configuration error
- **AND** it SHALL not read the user's secrets file directly

### Requirement: Redmine access SHALL be GET-only and fixed-scope
The adapter MUST use only GET against `https://redmine.codeages.work` and the `itsupportknowledge` project, with the API Key only in `X-Redmine-API-Key`.

#### Scenario: Tool input attempts to choose transport details
- **WHEN** input includes URL, method, header, credential, project identifier, or project ID
- **THEN** schema validation SHALL reject it before a Redmine request

#### Scenario: Adapter sends a request
- **WHEN** any project/search/detail request is issued
- **THEN** method SHALL be GET, redirect SHALL be rejected, origin SHALL remain fixed, and no key SHALL appear in URL/result/error

### Requirement: Search backend SHALL be explicit, bounded, and project-safe
The server SHALL use one startup-resolved `rest_search` or `issues_scan` backend and SHALL validate every candidate against the fixed project's numeric ID.

#### Scenario: Issues scan is selected
- **WHEN** the server uses `issues_scan`
- **THEN** it SHALL call `/issues.json` with fixed `project_id`, `status_id=*`, bounded history/page limits, and stable sort
- **AND** normalized pages MAY be cached in memory for at most 5 minutes

#### Scenario: Backend fails during a request
- **WHEN** the selected backend fails or times out
- **THEN** the call SHALL return a stable safe failure
- **AND** it MUST NOT switch backend or expand scope during the request

### Requirement: Search SHALL return at most ten bounded candidates
`redmine_search_issues` SHALL accept only bounded query/signals/status/limit and return a live search ID, at most 10 candidates, and truncation metadata.

#### Scenario: Search succeeds with candidates
- **WHEN** allowed fixed-project issues match
- **THEN** each candidate SHALL contain only issue ID, technical subject/excerpt, non-person status/tracker/priority, timestamps, and safe source locator

#### Scenario: Search succeeds without candidates
- **WHEN** no issue matches
- **THEN** candidates SHALL be empty and status SHALL be no-hit
- **AND** no historical conclusion SHALL be fabricated

### Requirement: Detail reads SHALL be authorized by the current search grant
`redmine_get_issue_case_details` MUST accept one live search ID and 1–3 unique candidate issue IDs from that grant.

#### Scenario: Caller reads authorized candidates
- **WHEN** IDs belong to the live grant
- **THEN** the server SHALL fetch only those details and revalidate fixed-project membership

#### Scenario: Caller reads unknown or expired candidates
- **WHEN** an ID is absent, duplicated, over-limit, or the grant expired
- **THEN** the server SHALL reject before making a detail request

### Requirement: Redmine output SHALL permanently enforce data minimization
The server MUST drop private journals, person identity, attachment names/URLs/bodies, unallowlisted custom fields, and raw errors before MCP output.

#### Scenario: Private and identity fields are present
- **WHEN** a fixture contains private notes, names, usernames, emails, IPs, phone numbers, or person IDs
- **THEN** none SHALL appear in normalized candidates/details, serialized MCP output, error, or logs

#### Scenario: Attachments are present
- **WHEN** details contain attachments
- **THEN** output MAY retain MIME, size, and counts
- **AND** it MUST omit filename, bytes, URL, token, and cookie

### Requirement: Historical details SHALL be structurally bounded
The combined details result SHALL not exceed 48,000 Unicode characters and MUST preserve valid JSON and complete evidence blocks.

#### Scenario: Normalized details exceed budget
- **WHEN** low-priority journals or attachment metadata exceed the budget
- **THEN** the server SHALL remove complete blocks and report omitted counts/truncated fields
- **AND** it MUST NOT slice serialized JSON arbitrarily

### Requirement: Default verification SHALL remain offline
Default build/test commands MUST use fixtures or fake transports and MUST NOT require Redmine credentials or network.

#### Scenario: Default suite runs
- **WHEN** `pnpm test` runs without Redmine configuration
- **THEN** all Redmine tests SHALL execute offline

#### Scenario: Real acceptance is explicitly invoked
- **WHEN** the opt-in command runs with the saved SecretRef
- **THEN** it SHALL perform only fixed-scope GET search/detail calls and safe Runtime/Worker reads
