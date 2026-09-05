---
description: Review code changes and create a commit following mini-agent repository standards
---

# Review & Commit Workflow

Review changed code for quality, correctness, security containment, and compliance with `mini-agent` standards, then commit if all checks pass.

## Phase 0: Detect Changes

```bash
git status
git diff --name-only
git diff --stat
```

1. Identify all changed files (`.js`, `.json`, `.md`)
2. Read full content of each changed file
3. Categorize by type and verify specific rules:
   - **Core Engine & Tools (`agent/*.js`, `tools/**/*.js`, `start.js`)**:
     - Strict CommonJS: `'use strict'` at top of every module.
     - Use `node:` prefix for Node.js built-ins (`node:fs`, `node:path`, `node:readline/promises`, `node:assert`, `node:test`).
     - Third-party dependencies kept minimal (`metautil`, `concolor`, `openai`). No heavy libraries.
     - **Terminal / Readline discipline**: Never attach a second `readline.createInterface` to `process.stdin` if one is active. Always pass `rl` to `createPermissions({ rl })` to prevent double-keystroke echo.
     - **Path Containment & Security**: All file operations must respect `workspace.resolveExistingFile()` or `workspace.resolveNewFile()`. Tool execution must not escape `workspace.root` or `workspace.gitRoot` without explicit permission.
     - **Tool Modules (`tools/<name>/`)**: Must export `definition`, `execute(args)`, `trust(args)`, and `describe(args)`.
   - **Prompts (`prompts/*.md`)**:
     - System prompts must remain in `prompts/`, separated from executable code in `agent/`.
   - **Documentation & Configs (`AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`)**:
     - Keep commands, links, and guidelines up to date.
     - `CLAUDE.md` references `@AGENTS.md` to avoid duplication.
   - **All files**: No hardcoded API keys, tokens, or personal secrets (use `dummy` key for local defaults).

## Phase 1: Code Review

For each changed file, check for violations and categorize:

- **Critical** — must fix before commit (syntax errors, security/path escapes, multiple stdin readline listeners, broken tool execution).
- **High** — should fix before commit (broken error handling, unhandled edge cases in tool execution, test regressions).
- **Medium** — nice to fix (formatting, naming consistency, redundant code).

If critical or high issues are found -> fix them before proceeding.

Before staging files, ask the user explicitly:

> Increase the package version and publish a tag/release for this commit? If yes, choose `patch`, `minor`, or `major`.

Do not bump the version, create a tag, push, or create a release without an explicit user approval. If approved, run the matching command before validation:

```bash
bun run bump:version -- patch
```

Replace `patch` with the approved level. Include the updated `package.json` in the commit. After the commit succeeds, create and push the tag. The existing release workflow creates the GitHub Release and uploads the platform binaries automatically:

```bash
tag="v$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
git tag "$tag"
git push origin HEAD "$tag"
```

If the user declines, create only the normal commit and do not create tags or releases.

### Run Validation Pipeline

```bash
bun run verify
```

This runs Biome lint, TypeScript typecheck, unit tests, and the production build
in one command. It must exit with code `0` before proceeding.

Optional syntax validation on modified files:
```bash
node --check <modified-file.js>
```

## Phase 2: Prepare Commit Message

**Format** (conventional commits):

```text
type: brief description

Optional body explaining rationale and key changes:
- Item 1
- Item 2
```

**Types:**
- `feat`: New tool, provider option, or harness capability
- `fix`: Bug fix in tool execution, permissions, readline handling, or agent loop
- `refactor`: Code reorganization or cleanup without behavior changes
- `test`: Adding or updating test suites in `tests/`
- `docs`: Documentation updates (README, AGENTS.md, CLAUDE.md, workflows)
- `style`: Formatting adjustments
- `chore`: Dependency updates, tooling, or workflow configurations
- `perf`: Performance or token-efficiency improvements

**Rules:**
- Subject line: lowercase `type:` prefix, max 72 characters
- No trailing period in the subject line
- Imperative mood ("add feature", not "added feature")

## Phase 3: Stage & Commit

```bash
git add <specific-files>
git status
git diff --cached
```

Verify:
- All intended source and test files are staged
- No temporary files, logs, or editor artifacts are included (`.DS_Store`, scratch files, etc.)

### Create Commit

```bash
git commit -m "type: description"
```

### Handle Test / Validation Failures

If validation fails:

1. Read error output carefully
2. Apply fixes:
   - Syntax errors: verify with `node --check <file>`
   - Test failures: resolve regressions and verify with `bun run test`
3. Stage fixed files: `git add <fixed-files>`
4. Create a **new** commit (never `--amend` unless explicitly requested by user)

### Verify Commit

```bash
git log --oneline -n 1
git diff HEAD~1 --stat
```

Confirm the commit message and changed files match intent.

## Review Summary

After commit, output the standard summary:

```text
Commit: [hash] [message]
Files: [count] | LOC: [additions+deletions]
Checks: tests [pass/fail]
Issues: [count critical] / [count high] / [count medium]
```

## Key Rules

1. **All checks pass** before commit (`bun run verify`).
2. **Use `bun run`** for tests and scripts.
3. **Conventional commits** — `type: description` format.
4. **New commits only** — never amend unless explicitly requested.
5. **Preserve containment & readline safety** at all times.
