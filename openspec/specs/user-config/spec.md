# user-config Specification

## Purpose

The user-config capability lets users define application-wide `mini-agent` defaults in a single user-level file, so every workspace inherits sane settings without per-project config duplication, while workspace configs still override them.

## Requirements

### Requirement: User-Level Config File
The system SHALL load a user-level configuration file from the user's config directory (`$XDG_CONFIG_HOME/mini-agent/` when set, otherwise `~/.config/mini-agent/`) using the same supported file names and formats as the workspace config, in addition to the workspace config.

#### Scenario: User config discovered
- **GIVEN** `~/.config/mini-agent/mini-agent.config.yaml` exists and the workspace has no config file
- **WHEN** `mini-agent` resolves its configuration
- **THEN** the user-level settings are applied as the effective configuration

#### Scenario: Missing user config directory
- **GIVEN** no user-level config file exists
- **WHEN** configuration is resolved
- **THEN** resolution proceeds with built-in defaults and the workspace config only, without error

#### Scenario: XDG override honored
- **GIVEN** `XDG_CONFIG_HOME` points to a custom directory containing `mini-agent/mini-agent.config.yaml`
- **WHEN** configuration is resolved
- **THEN** the file under `XDG_CONFIG_HOME` is used instead of `~/.config/mini-agent/`

### Requirement: Layered Merge Precedence
User-level and workspace-level config files SHALL merge section-by-section, with workspace values winning on conflict, and the combined result SHALL sit between built-in defaults and profile/env/CLI overrides.

#### Scenario: Workspace overrides user config
- **GIVEN** the user config sets `permission_mode: bypass` and the workspace config sets `permission_mode: normal`
- **WHEN** configuration is resolved for that workspace
- **THEN** `permission_mode` resolves to `normal`

#### Scenario: User config fills gaps
- **GIVEN** the user config sets `subagents.enabled: true` and the workspace config does not mention subagents
- **WHEN** configuration is resolved for that workspace
- **THEN** subagents are enabled

#### Scenario: Nested sections merge per key
- **GIVEN** the user config sets `cost_tracking.currency: EUR` and the workspace config sets `cost_tracking.enabled: true`
- **WHEN** configuration is resolved
- **THEN** both `currency: EUR` and `enabled: true` are effective

### Requirement: Wizard Scope Selection
The config wizard SHALL let the user choose whether to write the user-level config or the workspace config, defaulting to the user-level scope, and SHALL honor explicit scope flags without prompting.

#### Scenario: Interactive scope choice
- **WHEN** the user runs the wizard interactively
- **THEN** the first prompt offers user-level (default) and workspace scopes before section prompts begin

#### Scenario: Explicit user scope flag
- **WHEN** the user runs the wizard with the user-scope flag
- **THEN** the generated file is written under the user config directory without a scope prompt

#### Scenario: Explicit workspace scope flag
- **WHEN** the user runs the wizard with the workspace-scope flag
- **THEN** the generated file is written to the workspace root `mini-agent.config.yaml` without a scope prompt

#### Scenario: Scope honored by non-interactive modes
- **WHEN** the user runs `--defaults` or `--dry-run` with a scope flag
- **THEN** target resolution and reported paths reflect the chosen scope
