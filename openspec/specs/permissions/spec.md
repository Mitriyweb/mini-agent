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
