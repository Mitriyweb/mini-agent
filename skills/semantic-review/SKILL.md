---
name: semantic-review
description: Run a read-only, code-aware review of the requested changes using a delegated child agent and report evidence-based findings.
---

# Semantic Review

Perform a code-aware, read-only review of the requested change scope. This skill never modifies the workspace.

## Procedure

1. Determine the review scope from the user's request. If no scope is given, review the current uncommitted changes (`git status` and `git diff HEAD`).
2. Delegate the review to a child agent using the `delegate` tool with `access: "read-only"`. The child task must include:
   - The scope to review (files, diff, or feature area).
   - Instructions to inspect surrounding code for context, not just the diff.
   - Instructions to report findings with severity, file and line location when available, reasoning, and evidence.
3. Read-only access is enforced by the child's tool registry: it can inspect files but cannot modify them or run commands. Do not ask it to write anything.
4. If delegation is disabled or the child fails, report that explicitly. Do not substitute a different reviewer silently.

## Findings format

- List each finding with severity (`critical`, `high`, `medium`, `low`), location (`path:line` when available), reasoning, and the evidence observed.
- Distinguish confirmed defects from uncertainty or risks.
- If no actionable issues are found within the inspected scope, say so explicitly.
- If part of the scope could not be inspected (missing files, truncated diffs, unavailable evidence), disclose exactly what was not reviewed. Never claim a complete review that was not performed.
