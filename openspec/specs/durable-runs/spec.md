# durable-runs Specification

## Purpose

The durable-runs capability gives `mini-agent` a stable run identity and persistent run state so long-running tasks can be resumed safely after interruption or failure.

## Requirements

### Requirement: Explicit Runs Receive Stable IDs
The system SHALL assign a stable run ID to every explicit `mini-agent run "..."` invocation and persist that ID in run state.

#### Scenario: Explicit Run Starts
- **WHEN** a user invokes `mini-agent run "Implement feature X"`
- **THEN** the system creates a new run record with a unique run ID and stores the starting task, workspace, and timestamps.

### Requirement: Run State Is Persisted During Execution
The system SHALL write run state updates while execution is in progress so the run can be inspected, resumed, or recovered after an interruption.

#### Scenario: Progress Update
- **WHEN** a run advances to a new execution step or tool result
- **THEN** the persisted state reflects the latest status, step count, and last event position.

### Requirement: Resume Reuses Persisted Execution State
The system SHALL allow a run to be resumed from persisted state and SHALL not re-execute completed tool steps that have already been recorded as completed.

#### Scenario: Resume After Interruption
- **WHEN** a previously interrupted run is resumed
- **THEN** the system restores persisted state and continues only from the unfinished portion of the run.

### Requirement: Invalid Resume Attempts Fail Safely
The system SHALL reject resume attempts for completed runs and SHALL report invalid or corrupted run state clearly.

#### Scenario: Completed Run Cannot Be Resumed
- **WHEN** the user attempts to resume a run whose persisted state is marked completed
- **THEN** the system returns a clear error and does not re-run the task.

### Requirement: Failed Runs Can Be Recovered When State Is Valid
The system SHALL permit a failed run to be resumed when the stored state remains valid and the failure was recoverable.

#### Scenario: Retry Failed Run
- **WHEN** a failed run has valid persisted state
- **THEN** the system can resume the run and continue execution from the recorded checkpoint.

### Requirement: Persisted State Excludes Secrets
The system SHALL avoid writing secrets, API keys, authorization headers, or sensitive tool output into persisted run state.

#### Scenario: Secret Redaction
- **WHEN** a run persists tool or event metadata
- **THEN** sensitive values are redacted or omitted before state is written.
