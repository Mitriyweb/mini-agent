# structured-reports Specification

## Purpose

The structured-reports capability adds persistent, machine-readable output for each run so task outcomes can be inspected, reviewed, and integrated with later features.

## Requirements

### Requirement: Run Result Artifact
The system SHALL generate a valid `result.json` artifact for each completed or failed run when run state is persisted.

#### Scenario: Completed Run
- **WHEN** a run finishes successfully
- **THEN** the system writes a `result.json` containing the run ID, final status, task summary, and any available metadata.

### Requirement: Human-Readable Report Artifact
The system SHALL generate a `report.md` artifact describing the run outcome, key files changed, quality-gate results, and usage data when available.

#### Scenario: Failed Run
- **WHEN** a run ends in failure
- **THEN** the report includes the failure reason, relevant timestamps, and any available error details without exposing secrets.

### Requirement: Secret-Safe Reporting
The system SHALL redact or omit credentials, authorization headers, and other sensitive data from reports and result artifacts.

#### Scenario: Sensitive Data Present
- **WHEN** a run includes sensitive values in usage or tool output
- **THEN** the generated report omits or redacts those values before persisting the artifact.

### Requirement: Best-Effort Report Generation
The system SHALL treat report generation as a best-effort operation that does not itself turn a successful run into a failed run.

#### Scenario: Report Formatting Error
- **WHEN** a report file cannot be written due to a formatting issue
- **THEN** the system logs the issue but preserves the underlying run outcome and available artifacts.
