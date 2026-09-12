# mini-agent

A lightweight, modular coding agent harness supporting multi-provider LLMs (**Model Router**, **OpenAI**, **Anthropic**, **Google Gemini**), migrated to **TypeScript** and **ESM**.

---

## Features

- **Multi-Provider Architecture**:
  - **Model Router** (default: `http://localhost:8787/v1` with `model-router-auto`).
  - **Direct Provider Mode**: Work directly with **OpenAI**, **Anthropic**, **Google Gemini**, or OpenAI-compatible endpoints bypassing `model-router`.
  - **Dynamic Model Discovery**: Fetches real available models directly from provider APIs.
- **TypeScript & ESM**: Fully typed codebase targeting Node.js >= 20 and Bun.
- **Modular Local Tools**: Includes file & workspace operations (`read`, `write`, `edit`, `patch`, `delete`, `glob`, `grep`, `bash`, `check`, `fetch`, `todo`).
- **OpenAPI / OpenSpec Inspection**: Built-in `openspec` tool reads JSON/YAML specs, lists routes, and validates common OpenAPI structure issues.
- **Workflows & Slash Commands**: Auto-discovers step-by-step procedures in `.agents/workflows/*.md` and supports `/workflow-name` slash commands in interactive and batch modes.
- **Skills On-Demand**: Discovers capabilities in `.agents/skills/*/SKILL.md` with YAML frontmatter and exposes them directly to the agent's context.
- **Interactive Provider & Model Switching**: Change provider or model on the fly during REPL sessions with `/provider` and `/model`.
- **Safety & Containment**: Encapsulated `Workspace` class with lexical & realpath containment checks to prevent escaping the workspace directory. Granular permission system with `once`, `session`, and `always` scopes.

---

## Quick Start

### 1. Run via Model Router (Default)
```bash
bun run start
```
By default, `mini-agent` connects to `http://localhost:8787/v1` using `model-router-auto`.

### 2. Run Direct Provider Mode via CLI

#### OpenAI Direct:
```bash
bun run start -- --provider openai --model gpt-4o "Refactor src/utils/git.ts"
```

#### Anthropic Direct:
```bash
bun run start -- --provider anthropic --model claude-3-5-sonnet-20241022 "Add unit tests"
```

#### Google Gemini Direct:
```bash
bun run start -- --provider google --model gemini-1.5-flash "Fix lint issues"
```

---

## Options & Flags

```bash
bun run start -- [options] [task...]

Options:
  -y, --auto-approve, --yes   Auto-approve tool execution without interactive prompt
  --dir <path>                Set the project workspace directory
  -p, --provider <id>         Override LLM provider (router, openai, anthropic, google)
  --model <model_id>          Override model ID (default: model-router-auto for router)
  --url <base_url>            Override API base URL (default: http://localhost:8787/v1)
  --max-steps <number>        Max execution steps (default: 30)
  -v, --version               Show the installed version
  -h, --help                  Show this help text
```

---

## REPL Commands

In interactive mode (`bun run start`), the following built-in commands are available:

| Command | Description |
|---|---|
| `/provider [id]` | Show, select, or change LLM provider (`router`, `openai`, `anthropic`, `google`) |
| `/model [model_id]` | Fetch available models from current provider and select active model |
| `/help` | Show workflow, skill, provider, and command help |
| `/workflows` | List available workflow shortcuts |
| `/skills` | List available skills |
| `/max-steps <number>` | Set maximum execution steps for new tasks |
| `/auto-approve [on\|off]` | Toggle or set tool auto-approval |
| `/exit`, `/quit` | Exit the interactive session |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PROVIDER` | `router` | Default LLM provider (`router`, `openai`, `anthropic`, `google`) |
| `MODEL` | `model-router-auto` | Default model ID |
| `OPENAI_BASE_URL` | `http://localhost:8787/v1` | Base URL for OpenAI/Router |
| `OPENAI_API_KEY` | `dummy` | API key for OpenAI / Model Router |
| `ANTHROPIC_API_KEY` | (none) | API key for Anthropic direct mode |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | (none) | API key for Google Gemini direct mode |
| `AUTO_APPROVE` | `false` | Set to `true` to skip permission prompts |

---

## Available Tools

- `read`: Read file contents with offset and line limits.
- `write`: Create or overwrite a file inside the workspace.
- `edit`: Replace unique text fragments in a file (handles CRLF/LF line endings).
- `patch`: Apply multiple hunk replacements to a file.
- `delete`: Delete a file inside the workspace.
- `glob`: Search files by wildcard/glob pattern. Empty patterns are treated as a workspace-wide match (`**`).
- `grep`: Search file contents using regular expressions.
- `bash`: Run shell commands in the workspace root.
- `check`: Run syntax/type checks (`bun x tsc --noEmit` or `bun run check`).
- `fetch`: Fetch HTTP/HTTPS web documents.
- `todo`: Maintain structured task tracking lists.
- `openspec`: Read and work with openspec (OpenAPI-style) specification files.

---

## Permissions & Safety

`mini-agent` features a multi-level permission gate to control command execution safety (especially for `bash` operations). Rules are evaluated in deterministic order: `deny > allow exact > allow mask`.

---

## Tests & Verification

To run tests and verify the project:

```bash
bun test
bun run check
```
