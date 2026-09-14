# OpenSpec: Persistent Memory Domain Specification

## Overview
Provides bounded, persistent project knowledge shared between runs, allowing agents to retain architectural decisions and findings across independent executions.

## Purpose
Provides bounded, persistent project knowledge shared between runs, allowing agents to retain architectural decisions and findings across independent executions.

## Requirements

### Requirement: Persistent memory file
The system MUST read and manage a persistent memory file (e.g. `.mini-agent/memory.md`) to store project knowledge.

#### Scenario: Memory file loaded
- **WHEN** the agent run initializes and the memory file exists
- **THEN** the system loads the memory content into the agent's context, clearly marked as project knowledge rather than authoritative system instructions

#### Scenario: Memory file initialized
- **WHEN** memory is explicitly added and the file does not exist
- **THEN** the system creates the file with the expected structural format

### Requirement: Memory limits
The system MUST enforce size or entry limits on the persistent memory using a deterministic strategy to prevent context bloat.

#### Scenario: Memory truncation
- **WHEN** new entries exceed the configured limits
- **THEN** the system deterministically truncates older or less relevant entries to stay within bounds

### Requirement: Safe memory updates
The system MUST validate memory updates and MUST NOT allow arbitrary unstructured tool output to silently overwrite the memory file.

#### Scenario: Explicit memory update
- **WHEN** an update is initiated via the structured command interface
- **THEN** the system validates the update before applying it to the memory file

### Requirement: CLI memory operations
The system MUST provide command-line interfaces to inspect and update the memory.

#### Scenario: Show memory
- **WHEN** the user runs the `memory show` command
- **THEN** the system outputs the current contents of the memory

#### Scenario: Add memory
- **WHEN** the user runs the `memory add` command with new knowledge
- **THEN** the system appends the knowledge to the memory while respecting size limits