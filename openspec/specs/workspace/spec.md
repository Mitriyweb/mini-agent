# OpenSpec: Workspace Domain Specification

## Overview
The `workspace` domain tracks root and git boundaries to prevent path traversal security vulnerabilities.

## Requirements

### Requirement: Path Containment
All file access MUST resolve within workspace root or git root.

#### Scenario: Directory Traversal Rejection
- **Given** a relative path containing parent directory traversal (`../../../etc/passwd`)
- **When** workspace resolves the path
- **Then** access is rejected with a containment error.
