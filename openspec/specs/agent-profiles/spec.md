## Purpose

The agent-profiles capability lets `mini-agent` run with role-oriented configurations while preserving the default execution path for ordinary users.

## Requirements

### Requirement: Profile Selection
The system SHALL accept a `--profile <name>` CLI option and resolve the named profile before task execution begins.

#### Scenario: Developer Profile
- **WHEN** a user runs `mini-agent --profile developer "Implement feature X"`
- **THEN** the runtime resolves the developer profile and applies its configured overrides for the session.

### Requirement: Profile Validation
The system SHALL reject unknown profiles with a clear error and SHALL validate profile configuration before applying it.

#### Scenario: Unknown Profile
- **WHEN** a user requests a profile that does not exist
- **THEN** the system returns a clear profile-not-found error and does not continue with the task.

### Requirement: Profile Overrides Remain Safe
Profiles SHALL be able to adjust runtime behavior only within the existing configuration model and SHALL NOT bypass permission, workspace, or tool restrictions.

#### Scenario: Unsafe Profile Setting
- **WHEN** a profile attempts to override a restricted setting
- **THEN** the system either ignores the unsafe override or rejects the profile configuration.

### Requirement: Default Behavior Stays Compatible
The system SHALL preserve the current default CLI behavior when no profile is selected.

#### Scenario: No Profile Selected
- **WHEN** a user runs the existing `mini-agent "task"` invocation
- **THEN** the system uses the existing runtime configuration without requiring profile resolution.
