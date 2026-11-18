# session-logging Specification

## Purpose

The session-logging capability defines how the `logging.level` setting affects console output, ensuring that choosing `off` disables logging noise without making the agent unusable.

## Requirements

### Requirement: Log Level Off Preserves Assistant Output
When `logging.level` is `off`, the system SHALL suppress the full startup banner, step/tool event logs, and the log file sink, but SHALL still display assistant responses and final task results to the user.

#### Scenario: Assistant reply visible with logging off
- **GIVEN** `logging.level` is `off`
- **WHEN** the agent produces an assistant message
- **THEN** the message text is printed to the terminal

#### Scenario: Compact startup identity with logging off
- **GIVEN** `logging.level` is `off`
- **WHEN** an interactive or task run starts
- **THEN** a single compact identity line (`mini-agent v<version> · <workspace> · logging off`) is printed
- **AND** the full banner (provider, model, permissions, feature summary) is not printed

#### Scenario: Event noise suppressed with logging off
- **GIVEN** `logging.level` is `off`
- **WHEN** the agent executes tool calls and steps
- **THEN** no step banners, tool-call lines, or banner header are printed, and no log file entries are written

#### Scenario: Audit trail stays independent
- **GIVEN** `logging.level` is `off`
- **WHEN** tool calls or run lifecycle events occur
- **THEN** the audit trail is still written unless `audit.enabled` is `false` (see the audit-logging capability)
