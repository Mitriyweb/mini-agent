---
name: codebase-onboarding
description: Analyze an unfamiliar codebase and create a concise map of its stack, entry points, structure, conventions, commands, and request flow. Use when the user asks to understand or onboard into a repository.
---

# Codebase Onboarding

Use this skill only when the user needs an overview of an unfamiliar repository or asks for onboarding documentation. Do not activate it for a focused code change unless understanding the repository is the task.

## Lazy Context Rule

Read this file only when onboarding is requested. Start with repository signals and inspect selectively; never read every source file or load unrelated skills. Keep the final guide concise and distinguish verified facts from unknowns.

## Reconnaissance

Gather these signals in parallel where the available tools allow it:

- package manifests and language versions: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, and similar files;
- framework and build configuration;
- top-level and second-level directory structure, excluding generated and dependency directories;
- entry points such as `src/index.*`, `src/main.*`, `app.*`, `server.*`, or `cmd/`;
- test directories and configured test commands;
- CI, formatter, linter, and typecheck configuration;
- recent Git history for commit and branch conventions when available.

Use targeted `glob`, `grep`, and `read` operations. Prefer evidence from manifests and entry points over assumptions based on directory names.

## Architecture Map

Summarize:

- languages, runtime versions, frameworks, and important libraries;
- application shape, such as CLI, monolith, service, monorepo, or frontend/backend split;
- important directories and their responsibilities;
- entry points and the main execution path;
- request or command lifecycle from input to output;
- build, test, lint, and development commands.

For a CLI, trace argument parsing, workspace/config initialization, core execution, tool or service calls, and output/error handling. For a server, trace routing, validation, business logic, persistence, and response handling.

## Conventions

Record only conventions supported by the code:

- naming and file layout;
- module and dependency patterns;
- type and error-handling style;
- async or concurrency patterns;
- test organization;
- Git commit and PR conventions when history is available.

Flag unknowns instead of guessing. Do not list every dependency or repeat the README.

## Output

When asked to onboard the user, produce a short guide with:

1. project purpose and audience;
2. stack and runtime;
3. architecture and key directories;
4. entry points and execution flow;
5. verified conventions;
6. common development commands;
7. useful files to inspect next;
8. open questions or unknowns.

Only create or update `CLAUDE.md` when explicitly requested. If it already exists, read it first, preserve project-specific instructions, and keep the result under 100 lines when practical.
