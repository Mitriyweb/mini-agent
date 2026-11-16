# OpenSpec: Permissions Domain Specification

## Overview
The `permissions` domain controls command and tool execution safety using a strict precedence model: `deny > allow exact > allow mask`.

## Requirements

### Requirement: Rule Precedence & Evaluation
Rule evaluation MUST prioritize deny rules over allow rules, and exact command matching over wildcard mask matching.

#### Scenario: Deny Overrides Allow
- **Given** both a deny rule and an allow rule matching the same command
- **When** permission evaluation runs
- **Then** the decision is DENY.

### Requirement: Fail-Closed Wildcards
Broad wildcard rules MUST fail closed if dangerous shell constructs (subshells, backticks, redirection) are detected.

### Requirement: Permission Modes
The system SHALL support a permission mode setting with at least `normal` (the default) and `bypass` values, and SHALL accept the aliases `bypass`, `yolo`, and `dangerous` interchangeably wherever a mode value is supplied.

#### Scenario: Default mode is normal
- **GIVEN** no permission mode is configured or supplied
- **WHEN** the agent session starts
- **THEN** the effective permission mode is `normal` and approval prompts behave as they do today

#### Scenario: Alias normalization
- **GIVEN** a user supplies `yolo` or `dangerous` as the permission mode
- **WHEN** the mode is resolved
- **THEN** the effective permission mode is `bypass`

### Requirement: Bypass Mode Activation Surfaces
The system SHALL allow the permission mode to be set at session start via CLI flag, environment variable, or config file using the standard precedence order (defaults < config file < profile < environment < CLI), and SHALL allow switching modes during an interactive session via slash commands.

#### Scenario: CLI flag activation
- **GIVEN** a user starts mini-agent with a bypass permission mode flag or shorthand
- **WHEN** the session initializes
- **THEN** the effective permission mode is `bypass` for that session

#### Scenario: Environment and config activation
- **GIVEN** `MINI_AGENT_PERMISSION_MODE=bypass` is set or the config file declares `permission_mode: bypass`
- **WHEN** a session starts without a CLI override
- **THEN** the effective permission mode is `bypass`

#### Scenario: In-session mode switching
- **GIVEN** an interactive session is running in `normal` mode
- **WHEN** the user enters `/bypass` (or `/yolo`, `/dangerous`)
- **THEN** subsequent tool calls in that session auto-approve without prompting
- **WHEN** the user subsequently enters `/normal`
- **THEN** approval prompts resume for actions that require them

#### Scenario: Mode inspection
- **GIVEN** an interactive session is running
- **WHEN** the user enters `/mode`
- **THEN** the current effective permission mode is displayed

### Requirement: Bypass Auto-Approves Tool Prompts
While the effective permission mode is `bypass`, the system SHALL approve every tool permission prompt automatically without interactive confirmation, including prompts that would otherwise require approval for file writes, shell commands, fetches, and external CLI review bundle transmission.

#### Scenario: Write tool auto-approved
- **GIVEN** the session is in `bypass` mode
- **WHEN** the agent calls a tool that would normally require approval
- **THEN** the tool executes without prompting the user

#### Scenario: CLI review transmission auto-approved
- **GIVEN** the session is in `bypass` mode and a CLI review skill is invoked
- **WHEN** the review-bundle transmission approval is requested
- **THEN** transmission proceeds without an interactive prompt

### Requirement: Bypass Preserves Deny Rules and Workspace Containment
Bypass mode SHALL NOT override configured `deny` permission rules, trust-root checks, or workspace/git-root containment; actions blocked by those controls SHALL remain blocked in bypass mode.

#### Scenario: Deny rule still blocks
- **GIVEN** a `deny` permission rule matches a command and the session is in `bypass` mode
- **WHEN** the agent attempts that command
- **THEN** the action is denied without prompting

#### Scenario: Workspace escape still blocked
- **GIVEN** a file or command operation would escape the workspace or git root and the session is in `bypass` mode
- **WHEN** the operation is attempted
- **THEN** it is blocked by containment checks rather than auto-approved

### Requirement: Approval Prompt Bypass Option
When the interactive tool-approval prompt is shown, the system SHALL offer a bypass option that approves the pending action and switches the session to `bypass` mode for the remainder of the session. Programmatic approval callbacks SHALL be able to express the same choice. The prompt-based bypass SHALL be session-scoped only and SHALL NOT persist rules or modify saved configuration.

#### Scenario: Bypass selected at the prompt
- **GIVEN** a session in `normal` mode and a tool call that requires approval
- **WHEN** the user selects the bypass option in the approval prompt
- **THEN** the pending action is approved and executed, and subsequent tool calls in that session auto-approve without prompting

#### Scenario: Bypass declined at the prompt
- **GIVEN** a session in `normal` mode and a tool call that requires approval
- **WHEN** the user rejects or ignores the bypass option
- **THEN** the session remains in `normal` mode and normal approval behavior continues

#### Scenario: Prompt bypass honors deny rules
- **GIVEN** a session that entered `bypass` mode via the approval prompt
- **WHEN** the agent attempts an action matched by a configured `deny` rule
- **THEN** the action is denied without prompting, exactly as in bypass mode entered by any other surface

#### Scenario: Callback-driven approval UI offers bypass
- **GIVEN** an approval flow driven by an `askDecision`-style callback rather than the built-in prompt
- **WHEN** the callback returns the bypass decision
- **THEN** the pending action is approved and the session permission mode becomes `bypass`

### Requirement: Permission Mode Inheritance and Scope
The effective permission mode SHALL propagate to delegated subagent runs, and in-session mode changes SHALL apply to subsequently executed work in that session. Existing auto-approve behavior (`-y`/`--auto-approve`) SHALL remain prompt-scoped only and SHALL NOT skip quality gates.

#### Scenario: Subagent inherits bypass
- **GIVEN** a parent session in `bypass` mode delegates a write-capable subtask
- **WHEN** the child agent executes tools requiring approval
- **THEN** the child auto-approves them under the inherited bypass mode

#### Scenario: Read-only child unaffected
- **GIVEN** a parent session in `bypass` mode delegates a `read-only` subtask
- **WHEN** the child executes
- **THEN** it retains only read-only tools and cannot gain write access from the parent's mode

#### Scenario: Auto-approve does not imply bypass
- **GIVEN** a session started with `-y`/`--auto-approve` but no bypass mode
- **WHEN** the agent completes a task
- **THEN** tool prompts are suppressed as before but configured quality gates still execute
