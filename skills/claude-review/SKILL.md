---
name: claude-review
description: Send a redacted review bundle of the current changes to the Claude CLI for an independent read-only review.
---

# Claude CLI Review

Run an independent code review through the installed Claude Code CLI (`claude`). This skill is read-only with respect to the workspace: the CLI receives only a redacted review bundle and cannot access the original workspace.

## Prerequisites

- The `claude` CLI must be installed and authenticated. If it is missing or unauthenticated, the review fails explicitly; do not substitute another reviewer.

## Procedure

1. Call the `claude_review` tool. Optionally pass `focus` to narrow the review (a file, module, or concern).
2. The tool requires approval before transmitting the bundle. If approval is denied, report that the review was not run.
3. The tool builds a redacted review bundle (credentials and sensitive paths removed, size-limited), writes it to an isolated temporary directory, and invokes `claude` non-interactively in read-only plan mode with the bundle on stdin.
4. Report the CLI's findings using the same format as semantic review: severity, file/line location, reasoning, and evidence; distinguish confirmed defects from uncertainty; disclose incomplete evidence.

## Failure handling

Report these explicitly without falling back to another reviewer:

- `claude` CLI not found on PATH or not authenticated.
- Approval denied for bundle transmission.
- Non-zero exit, timeout, cancellation, or empty/unusable output.
