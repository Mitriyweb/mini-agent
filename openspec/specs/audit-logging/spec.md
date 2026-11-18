# audit-logging Specification

## Purpose

The audit-logging capability defines the append-only `.mini-agent/audit.jsonl` trail that records tool calls and run lifecycle events, and how it is configured independently from console logging.

## Requirements

### Requirement: Audit Trail Is Independent of Log Level
The system SHALL write audit events regardless of `logging.level`, including when logging is `off`, and SHALL control the trail through a dedicated `audit` configuration section instead.

#### Scenario: Logging off keeps the audit trail enabled
- **GIVEN** `logging.level` is `off` and `audit.enabled` is unset
- **WHEN** the agent executes a tool call
- **THEN** no console or log-file output is produced
- **AND** the tool call and its result are appended to `.mini-agent/audit.jsonl`

#### Scenario: Audit disabled explicitly
- **GIVEN** `audit.enabled` is `false`
- **WHEN** the agent executes tool calls and the run starts or completes
- **THEN** no audit directory or audit file is created
- **AND** no audit events are written

### Requirement: Audit Configuration
The system SHALL resolve `audit.enabled` (default `true`) and an optional `audit.filePath` using the same layering as other config keys: built-in defaults < user-level file < workspace file < environment variables < CLI.

#### Scenario: Default location
- **GIVEN** `audit.enabled` is `true` and `audit.filePath` is unset
- **WHEN** an audit event is recorded
- **THEN** it is appended to `<workspace>/.mini-agent/audit.jsonl`

#### Scenario: Custom path
- **GIVEN** `audit.filePath` is `logs/audit.jsonl`
- **WHEN** an audit event is recorded
- **THEN** the event is appended to `<workspace>/logs/audit.jsonl`

#### Scenario: Environment override
- **GIVEN** a config file sets `audit.enabled: true`
- **WHEN** `MINI_AGENT_AUDIT_ENABLED=false` is set in the environment
- **THEN** audit writes are disabled for the run
