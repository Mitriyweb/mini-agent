# session-logging Specification

## Purpose

The session-logging capability defines how the `logging.level` setting affects console output, ensuring that choosing `off` disables logging noise without making the agent unusable.

## Requirements

### Requirement: Log Level Off Preserves Assistant Output
When `logging.level` is `off`, the system SHALL suppress the startup banner, step/tool event logs, and the log file sink, but SHALL still display assistant responses and final task results to the user.

#### Scenario: Assistant reply visible with logging off
- **GIVEN** `logging.level` is `off`
- **WHEN** the agent produces an assistant message
- **THEN** the message text is printed to the terminal

#### Scenario: Event noise suppressed with logging off
- **GIVEN** `logging.level` is `off`
- **WHEN** the agent executes tool calls and steps
- **THEN** no step banners, tool-call lines, or banner header are printed, and no log file entries are written
