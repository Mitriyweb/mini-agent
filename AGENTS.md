# AGENTS.md

Guidance and operational standards for AI coding agents working with the `mini-agent` repository.

## Mission & Scope

`mini-agent` is a compact, self-contained coding agent harness designed to operate seamlessly with `model-router` (or any OpenAI-compatible completions endpoint). It is designed to be extracted, modified, and embedded into independent workflows without external build steps or heavy dependencies.

## Key Developer Commands

| Action | Bun | Node |
|---|---|---|
| Run tests | `bun run test` | `bun test` |
| Typecheck | `bun run check` | `bun x tsc --noEmit` |
| Build | `bun run build` | `bun x tsc` |
| Start interactive REPL | `bun run start` | `node dist/start.js` (after build) |
| Dev REPL (no build) | `bun run dev` | — |
| Single task execution | `bun run start -- -y "<task>"` | `node dist/start.js -y "<task>"` |
| Target specific workspace | `bun run start -- --dir <path> -y "<task>"` | `node dist/start.js --dir <path> -y "<task>"` |

## Project Architecture

Source lives in `src/` (TypeScript, ESM); `bun run build` emits `dist/`. Tests live in `tests/` and import from `../src/*.js` (Bun resolves the `.ts` sources).

### 1. Execution Flow
```
User Prompt (CLI / REPL)
       ↓
src/start.ts (parseArgs / readline REPL)
       ↓
src/agent/agent.ts (runAgent loop)
       ↓
src/agent/llm.ts + src/agent/providers/ (chat completions with retry & fallback)
       ↓
Tool Call Request
       ↓
src/agent/permissions.ts (trust-root checks & interactive approval)
       ↓
src/tools/<tool> (tool execution)
       ↓
Context Update & Next Iteration
```

### 2. Core Modules
- **`src/start.ts`**: CLI arguments parser (`parseArgs`), interactive terminal REPL, event logging (`createEventHandler`), graceful cleanup.
- **`src/agent/agent.ts`**: The `runAgent` loop. Manages message history, tracks step limits (`maxSteps`), invokes tools, truncates large outputs, and wires optional subagent delegation and CLI review tools into the registry.
- **`src/agent/subagents.ts`**: Opt-in child-agent delegation (`subagents` config). Provides `SubagentsConfig` validation/defaults, the read-only tool registry (`createReadOnlyRegistry`), the `delegate` tool, the bounded-concurrency/cancellation scheduler (`runDelegatedBatch`), and `serializeApprovals` for interactive write approvals.
- **`src/agent/cli-review.ts` + `src/tools/cli-review.ts`**: Constrained Claude/Codex CLI reviewer adapter. Builds a redacted review bundle (reusing `ReviewOrchestrator`), runs the CLI from an isolated temp dir with fixed read-only args and the bundle on stdin, and enforces approval, timeout, and cancellation.
- **`src/agent/builtin-skills.ts` + `src/agent/bun-builtin-skills.ts` + `skills/`**: Built-in fallback skills (`semantic-review`, `claude-review`, `codex-review`) shipped with the package; workspace/user skills take precedence. `.md` assets load via `with { type: 'text' }` under Bun and `readFileSync` under Node (see `bun-prompts.ts` pattern).
- **`src/agent/permissions.ts`**: Controls execution safety. Checks whether file or bash commands escape the git root (`toolLeavesTrustRoot`). Manages approval prompt (`rl.question`). Reuses injected `rl` to prevent terminal keypress duplication.
- **`src/agent/workspace.ts`**: Tracks `workspace.root` and `workspace.gitRoot`. Guarantees file operations remain contained inside the workspace.
- **`src/agent/llm.ts` + `src/agent/providers/`**: Provider registry and chat-completions client. Handles HTTP 429/503 retries, exponential backoff, and fallback models.
- **`src/agent/config.ts`**: Loads `mini-agent.config.yaml`/`.json`/`.mini-agentrc.*` and resolves settings with precedence defaults < file < profile < env < CLI. Validates retry, review, quality-gates, and subagents sections.
- **`src/agent/customizations.ts`**: Discovers and parses workflows (`.agents/workflows/*.md`) and skills (`.agents/skills/*/SKILL.md`), manages slash commands (`/workflow-name`), appends built-in skills as fallback, and injects customization catalogs into the system prompt.
- **`src/agent/orchestrator/`**: Deterministic OpenSpec change runner (`mini-agent apply <change>`): parses `tasks.md`, selects tasks, delegates each to `runAgent`, validates quality gates, marks tasks complete.
- **`prompts/system.md` + `prompts/coding-standards.md`**: Base system prompt and coding standards loaded by `instructions.ts`.
- **`src/tools/`**: Modular tools (`read`, `write`, `edit`, `patch`, `delete`, `glob`, `grep`, `bash`, `check`, `fetch`, `todo`, `openspec`, `delegate` via `subagents.ts`, `claude_review`/`codex_review`). Each exports `definition`, `execute(args)`, `trust(args)`, and `describe(args)`.

## Agent Coding Guidelines

- **Module Format**: TypeScript ESM (`import`/`export`, `.ts` extension on relative imports). CommonJS `require` is not used.
- **Dependencies**: Keep dependencies lightweight (`metautil`, `concolor`, `openai`, `js-yaml`). Do not add heavy dependencies without clear necessity.
- **Imports**: Always use `node:` prefix for Node.js built-ins (`node:fs`, `node:path`, `node:readline/promises`, etc.).
- **Markdown assets**: Ship prompt/skill `.md` files outside `src/` and load them via the `bun-prompts.ts` dual pattern (Bun text import vs Node `readFileSync` on `import.meta.url`); declare `*.md` modules in `src/types/assets.d.ts`.
- **Terminal Handling**: Never attach a second `readline.createInterface` to `process.stdin` if one is already active. Always pass `rl` to `createPermissions({ rl })`.
- **Path Containment**: Ensure all file access respects `workspace.resolveExistingFile()` or `workspace.resolveNewFile()` to avoid escaping the root.
- **Permission modes**: `permissionMode` (`normal` default | `bypass`) resolves via config/env/CLI and is consumed by `createPermissions`. Bypass auto-approves prompts and skips quality gates, but deny rules are evaluated first and path/command tools escaping the trust root fail closed. In-session switching goes through `permissions.setPermissionMode` (`/bypass`, `/normal`, `/mode`, approval-prompt option 6); `autoApprove` (`-y`) remains prompt-scoped only.
- **Subagents**: Delegation is opt-in (`subagents.enabled`). Read-only children must use `createReadOnlyRegistry` — never rely on prompt instructions for access control. Write children share the workspace; keep batches to independent tasks and serialize interactive approvals.
- **CLI reviewers**: Never assemble shell commands for `claude`/`codex`; use `runCliReview` with the fixed arg arrays in `CLI_REVIEW_SPECS`. Fail closed on missing CLI, non-zero exit, timeout, or empty output.
- **Validation**: After modifying code, always execute `bun run check` and `bun run test` to verify that all suites pass.
