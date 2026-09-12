# OpenSpec: Built-in Tools Specification

## Overview
The `tools` domain provides 12 built-in local operations (`read`, `write`, `edit`, `patch`, `delete`, `glob`, `grep`, `bash`, `check`, `fetch`, `todo`, `openspec`).

## Requirements

### Requirement: Workspace File Operations
Tools MUST operate strictly within workspace bounds and support read, write, edit, patch, and delete operations.

#### Scenario: Read and Write Files
- **Given** a relative file path inside the workspace
- **When** `write` or `read` tools are executed
- **Then** content is saved or retrieved safely.

### Requirement: OpenSpec Tool
The `openspec` tool MUST support reading, validating, and extracting information (`info`, `paths`, `operations`, `validate`) from JSON/YAML specification files.

#### Scenario: Validate OpenAPI File
- **Given** an OpenAPI 3.0 file
- **When** `openspec` tool runs with operation `validate`
- **Then** error and warning diagnostics are returned.
