# subagent-orchestration Specification

## Purpose

Allows an agent to delegate bounded work to isolated child-agent runs, choose the permission mode for each subtask, and combine results without sharing conversation state.

## Requirements

### Requirement: Isolated Child-Agent Tasks
The system MUST let an agent delegate a bounded subtask to a child agent with independent conversation state and return the child's status and findings to the parent.

#### Scenario: Child completes a delegated task
- **GIVEN** child-agent delegation is enabled
- **WHEN** the parent delegates a task with a valid execution limit
- **THEN** the child runs with a separate conversation and returns its completion status and response to the parent

#### Scenario: Child task fails
- **GIVEN** a delegated child task encounters an execution or provider error
- **WHEN** the child run ends unsuccessfully
- **THEN** the parent receives an explicit failure status and error details rather than a success-shaped response

### Requirement: Per-Task Permission Modes
The system MUST require each delegated task to select either read-only or write-capable access, and MUST enforce that mode through the tools and permissions available to the child.

#### Scenario: Read-only child task
- **GIVEN** a delegated task selects read-only access
- **WHEN** the child executes
- **THEN** it can inspect workspace content but cannot modify files or execute commands that may write to the workspace

#### Scenario: Write-capable child task
- **GIVEN** a delegated task selects write-capable access
- **WHEN** the child executes a modifying operation
- **THEN** the operation remains subject to workspace containment and the configured permission-approval flow

### Requirement: Bounded Parallel Delegation
The system MUST support running independent delegated tasks concurrently up to a configured positive limit and MUST report each task's result separately.

#### Scenario: Concurrent tasks respect the configured limit
- **GIVEN** a batch contains more tasks than the configured concurrency limit
- **WHEN** the parent delegates the batch
- **THEN** no more than the configured number of child tasks run at once and all task results are associated with their respective tasks

#### Scenario: Delegation is disabled
- **GIVEN** child-agent delegation is disabled by configuration
- **WHEN** an agent attempts to delegate a task
- **THEN** the delegation is rejected explicitly and no child run starts

### Requirement: Bounded Child Execution
The system MUST apply configured step limits and cancellation to child runs and MUST prevent child agents from recursively creating further child agents unless recursion is explicitly enabled.

#### Scenario: Child exceeds its step limit
- **GIVEN** a child task requires more steps than its configured maximum
- **WHEN** the limit is reached
- **THEN** the child returns an explicit failure status indicating that its execution limit was exceeded

#### Scenario: Parent cancels delegated work
- **GIVEN** child tasks are running under a parent task
- **WHEN** the parent task is cancelled
- **THEN** the cancellation signal is propagated to its running children and their results are reported as interrupted
