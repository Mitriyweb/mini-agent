# semantic-review Specification

## Purpose

Provides an explicit, reusable semantic-review workflow that examines code changes in their surrounding project context and returns evidence-based findings without changing the workspace.

## Requirements

### Requirement: Explicit Semantic-Review Skill
The system MUST provide discoverable `semantic-review`, `claude-review`, and `codex-review` skills that can be invoked explicitly and direct the agent to review the requested changes.

#### Scenario: Invoke the semantic-review skill
- **GIVEN** skills are enabled and the `semantic-review` skill is available
- **WHEN** a user invokes `/semantic-review` or requests that skill by name
- **THEN** the agent follows the skill's review procedure for the requested change scope

#### Scenario: Invoke a CLI reviewer
- **GIVEN** the corresponding CLI reviewer skill is available
- **WHEN** a user invokes `/claude-review` or `/codex-review`
- **THEN** mini-agent invokes only the selected Claude or Codex CLI reviewer

#### Scenario: Built-in skill in a different workspace
- **GIVEN** skills are enabled and the active workspace has no `semantic-review` customization
- **WHEN** the agent loads available skills
- **THEN** the built-in `semantic-review` skill is available as a fallback

### Requirement: Read-Only Review
The semantic-review workflow MUST use read-only child-agent access and MUST NOT modify workspace files.

#### Scenario: Review with no modifications
- **GIVEN** the semantic-review workflow is reviewing a change
- **WHEN** the reviewer inspects diffs and surrounding code
- **THEN** it uses only read-only capabilities and leaves the workspace unchanged

### Requirement: Evidence-Based Findings
The semantic-review workflow MUST report actionable findings with severity and code-location evidence, distinguish confirmed defects from uncertainty, and disclose when the available evidence is incomplete.

#### Scenario: Report a confirmed issue
- **GIVEN** the reviewer identifies a behavior or correctness issue in the requested scope
- **WHEN** it returns its review
- **THEN** the finding includes its severity, affected file and location when available, the reasoning, and the relevant evidence

#### Scenario: No findings or incomplete evidence
- **GIVEN** the reviewer completes the requested inspection
- **WHEN** it finds no actionable issue or cannot inspect all relevant evidence
- **THEN** it explicitly reports either that no findings were identified within the inspected scope or which evidence was unavailable, without claiming an unperformed or complete review

### Requirement: Read-Only CLI Review Input
CLI-backed review skills MUST invoke the selected CLI non-interactively in a read-only, isolated environment, MUST provide only the redacted review bundle, and MUST obtain tool approval before transmitting it.

#### Scenario: Submit a review bundle to a CLI
- **GIVEN** a user invokes a CLI-backed review skill and its CLI is available
- **WHEN** mini-agent starts the selected reviewer
- **THEN** it passes only the redacted review bundle from an isolated temporary directory and uses a non-interactive read-only invocation that cannot access the original workspace

#### Scenario: Review transmission is denied
- **GIVEN** a user invokes a CLI-backed review skill
- **WHEN** the tool-approval flow denies transmission of the review bundle
- **THEN** mini-agent does not start the external CLI and reports that review was not run

### Requirement: Explicit CLI Review Failures
The system MUST report CLI review setup, execution, or response failures explicitly and MUST NOT silently substitute another reviewer or claim a successful review.

#### Scenario: CLI is unavailable or review fails
- **GIVEN** the selected CLI is missing, unauthenticated, exits unsuccessfully, or returns an unusable review
- **WHEN** the CLI-backed review is requested
- **THEN** mini-agent reports the failure and its cause without invoking another reviewer or reporting a successful review
