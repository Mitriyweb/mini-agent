# OpenSpec: Agent Domain Specification

## Overview
The `agent` domain manages the primary autonomous execution loop (`runAgent`), step limitations (`maxSteps`), message history tracking, system prompt composition, and skill filtering.

## Requirements

### Requirement: Agent Execution Loop
The agent loop MUST execute tool calls step-by-step up to `maxSteps` (default: 30) and return the final text output and token usage summary.

#### Scenario: Successful Task Execution
- **Given** a user task and valid LLM provider
- **When** `runAgent` is called
- **Then** the agent iterates, executes requested tools, and completes with `AgentResult`.

#### Scenario: Step Limit Exceeded
- **Given** a task that requires more iterations than `maxSteps`
- **When** the step limit is reached
- **Then** `runAgent` throws an error stating that the maximum steps were exceeded.

### Requirement: System Prompt & Customizations
The agent MUST format system instructions by combining base coding standards with loaded workflows and filtered skills.

#### Scenario: Skill Filtering
- **Given** available skills in `.agents/skills`
- **When** skills configuration specifies allow/deny lists
- **Then** deny rules take precedence over allow rules and excluded skills are omitted.
