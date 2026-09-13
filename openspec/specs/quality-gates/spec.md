# quality-gates Specification

## Purpose

The quality-gates capability makes project verification explicit and evidence-based so `mini-agent` can distinguish passing work from unchecked work.

## Requirements

### Requirement: Named Gate Definitions
The system SHALL support configurable quality gates with an identifier, display name, command, and required flag.

#### Scenario: Gate Configuration
- **WHEN** a project config defines quality gates
- **THEN** the runtime loads those gates as structured data and validates each entry before execution.

### Requirement: Gate Execution and Result Capture
The system SHALL execute each configured gate and capture exit code, stdout, stderr, and duration in a structured result.

#### Scenario: Gate Execution
- **WHEN** a gate command is run
- **THEN** the runtime records the command result as passed, failed, or skipped with the associated execution details.

### Requirement: Required Gate Failure Blocks Success
The system SHALL treat a required failing gate as a failed verification result and SHALL not allow the task to be reported as successful while that gate remains failed.

#### Scenario: Required Gate Fails
- **WHEN** a required gate exits non-zero
- **THEN** the runtime returns an unsuccessful verification state and exposes the gate failure to the agent.

### Requirement: Optional Gates Can Be Skipped
The system SHALL allow optional gates to be skipped when not defined, unavailable, or intentionally marked non-required.

#### Scenario: Optional Gate Not Configured
- **WHEN** an optional gate is not configured for a project
- **THEN** the system marks it skipped rather than failing the run.

### Requirement: Configurable Discovery
The system SHALL support discovery of sensible default gates when project-level configuration is absent or incomplete.

#### Scenario: Default Gate Discovery
- **WHEN** quality gates are enabled but no explicit config is present
- **THEN** the runtime can discover a reasonable default set of project checks from the workspace metadata and project scripts.
