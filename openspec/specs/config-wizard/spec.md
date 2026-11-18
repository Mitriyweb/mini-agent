# config-wizard Specification

## Purpose

The config-wizard capability lets users generate a valid `mini-agent` configuration interactively or non-interactively, so installation and onboarding do not require hand-editing YAML against documentation.

## Requirements

### Requirement: Wizard Command Availability
The system SHALL expose a CLI command that starts an interactive configuration wizard for the installed `mini-agent`.

#### Scenario: Start wizard interactively
- **WHEN** a user runs the config wizard command in a terminal
- **THEN** the system presents a step-by-step prompt flow for configuration sections

#### Scenario: Wizard in non-interactive context
- **WHEN** the wizard command runs without an interactive terminal and no non-interactive flag is given
- **THEN** the system exits with a clear error explaining that interactive input or a non-interactive flag is required

### Requirement: Section Coverage and Defaults
The wizard SHALL cover every option documented in `mini-agent.config.example.yaml` (kept in sync with the full config schema) and SHALL pre-fill each prompt with the effective default or the value from any existing config file.

#### Scenario: Prompt shows current value
- **GIVEN** an existing `mini-agent.config.yaml` declares `permission_mode: bypass`
- **WHEN** the user reaches the permission-mode step
- **THEN** the prompt offers `bypass` as the current value and accepts keeping it

#### Scenario: Defaults offered for unset options
- **GIVEN** no config file exists
- **WHEN** the user reaches any section
- **THEN** the prompt presents the documented default as the pre-selected value

#### Scenario: Logging defaults to off
- **GIVEN** no config file exists or no logging level is set
- **WHEN** the user reaches the logging section or uses defaults mode
- **THEN** the pre-selected/generated logging level is `off`

#### Scenario: Audit defaults to enabled
- **GIVEN** no config file exists or no audit setting is set
- **WHEN** the user reaches the audit section or uses defaults mode
- **THEN** `audit.enabled` is pre-selected/generated as `true`

### Requirement: Inline Validation
The wizard SHALL validate each answer against the same rules the config loader enforces and SHALL reject invalid input with a corrective message before moving on.

#### Scenario: Invalid enum rejected
- **WHEN** the user enters an unknown permission mode such as `yolo2`
- **THEN** the wizard reports the accepted values and re-prompts without writing anything

#### Scenario: Valid alias normalized
- **WHEN** the user enters `yolo` for the permission mode
- **THEN** the wizard accepts it and records the normalized `bypass` value

### Requirement: Output Target and Write Behavior
The wizard SHALL write the resulting configuration as YAML (or JSON when requested) to the workspace root by default, SHALL honor `--dir` and `--config` target overrides, and SHALL refuse to overwrite an existing config file without explicit confirmation unless a force flag is given.

#### Scenario: Write to workspace root
- **WHEN** the user completes the wizard in a workspace without an existing config
- **THEN** a valid `mini-agent.config.yaml` is created in the workspace root and is picked up automatically as the application default on subsequent runs

#### Scenario: Existing file protection
- **GIVEN** `mini-agent.config.yaml` already exists
- **WHEN** the user completes the wizard without a force flag
- **THEN** the wizard warns and asks for confirmation before overwriting, or aborts without modifying the file if declined

#### Scenario: Explicit target path
- **WHEN** the user passes a config output path
- **THEN** the wizard writes the file to that path instead of the workspace root

### Requirement: Non-Interactive Modes
The system SHALL support generating a configuration without prompts: a defaults mode that writes a fully commented default config, and a dry-run mode that prints the generated YAML without writing.

#### Scenario: Defaults mode
- **WHEN** the user runs the wizard with the defaults flag
- **THEN** a complete default configuration file is written without any prompts

#### Scenario: Dry run
- **WHEN** the user runs the wizard with the dry-run flag
- **THEN** the generated YAML is printed to stdout and no file is created or modified

### Requirement: Generated Config Loads Cleanly
Every file produced by the wizard SHALL pass the same load-time validation as a hand-written config, including section schemas, enum values, and cross-field constraints.

#### Scenario: Round-trip validation
- **WHEN** a wizard-generated config is loaded by a subsequent `mini-agent` run
- **THEN** it is accepted without configuration errors

#### Scenario: Invalid combination prevented
- **WHEN** a section combination would be rejected at load time (for example, an unknown custom provider ID colliding with a built-in)
- **THEN** the wizard rejects it during prompting rather than emitting an unloadable file
