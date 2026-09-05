# AGENTS.md

Guidance and operational standards for AI coding agents working with the `mini-agent` repository.

## Mission & Scope

`mini-agent` is a compact, self-contained coding agent harness designed to operate seamlessly with `model-router` (or any OpenAI-compatible completions endpoint). It is designed to be extracted, modified, and embedded into independent workflows without external build steps or heavy dependencies.

## Key Developer Commands

| Action | Bun | Node / bun |
|---|---|---|
| Run tests | `bun run test` | `bun test` or `node --test tests/*.test.js` |
| Start interactive REPL | `bun run start` | `node start.js` |
| Single task execution | `bun run start -- -y "<task>"` | `node start.js -y "<task>"` |
| Target specific workspace | `bun run start -- --dir <path> -y "<task>"` | `node start.js --dir <path> -y "<task>"` |

## Project Architecture

### 1. Execution Flow
```
User Prompt (CLI / REPL)
       ↓
start.js (parseArgs / readline REPL)
       ↓
agent/agent.js (runAgent loop)
       ↓
agent/llm.js (chat completions with retry & fallback)
       ↓
Tool Call Request
       ↓
agent/permissions.js (trust-root checks & interactive approval)
       ↓
tools/<tool-name>/ (tool execution)
       ↓
Context Update & Next Iteration
```

### 2. Core Modules
- **`start.js`**: CLI arguments parser (`parseArgs`), interactive terminal REPL, event logging (`createEventHandler`), graceful cleanup.
- **`agent/agent.js`**: The `runAgent` loop. Manages message history, tracks step limits (`maxSteps`), invokes tools, and truncates large outputs.
- **`agent/permissions.js`**: Controls execution safety. Checks whether file or bash commands escape the git root (`toolLeavesTrustRoot`). Manages approval prompt (`rl.question`). Reuses injected `rl` to prevent terminal keypress duplication.
- **`agent/workspace.js`**: Tracks `workspace.root` and `workspace.gitRoot`. Guarantees file operations remain contained inside the workspace.
- **`agent/llm.js`**: Configures the OpenAI client. Handles HTTP 429/503 retries, exponential backoff, and fallback models.
- **`prompts/system.md`**: Base system prompt defining the agent's operating behavior and tool discipline.
- **`tools/`**: Modular directory-based tools. Each tool exports `definition`, `execute(args)`, `trust(args)`, and `describe(args)`.

## Agent Coding Guidelines

- **Module Format**: CommonJS (`'use strict'`, `require`, `module.exports`).
- **Dependencies**: Keep dependencies lightweight (`metautil`, `concolor`, `openai`). Do not add heavy dependencies without clear necessity.
- **Imports**: Always use `node:` prefix for Node.js built-ins (`node:fs`, `node:path`, `node:readline/promises`, etc.).
- **Terminal Handling**: Never attach a second `readline.createInterface` to `process.stdin` if one is already active. Always pass `rl` to `createPermissions({ rl })`.
- **Path Containment**: Ensure all file access respects `workspace.resolveExistingFile()` or `workspace.resolveNewFile()` to avoid escaping the root.
- **Validation**: After modifying code, always execute `bun run test` to verify that all suites pass.
