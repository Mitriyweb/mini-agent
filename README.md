# mini-agent

A lightweight, modular coding agent harness compatible with **`model-router`** (or any OpenAI-compatible Chat Completions API), migrated to **TypeScript** and **ESM**.

---

## Features

- **TypeScript & ESM**: Fully typed codebase targetting Node.js >= 20 and Bun.
- **Model Router Integration**: Pre-configured to connect to `http://localhost:8787/v1` with model `model-router-auto`.
- **Modular Local Tools**: Includes file & workspace operations (`read`, `write`, `edit`, `patch`, `delete`, `glob`, `grep`, `bash`, `check`, `fetch`, `todo`).
- **Workflows & Slash Commands**: Auto-discovers step-by-step procedures in `.agents/workflows/*.md` and supports `/workflow-name` slash commands in interactive and batch modes.
- **Skills On-Demand**: Discovers capabilities in `.agents/skills/*/SKILL.md` with YAML frontmatter and exposes them directly to the agent's context.
- **Lazy Skill Loading**: Adds only skill metadata to the prompt; full skill instructions are read only when relevant to the current task.
- **CRLF/LF Normalization**: Handles cross-platform line ending differences during text edits and patches.
- **Interactive & CLI Modes**:
  - Run a single task from CLI arguments with `bun run start -- -y "Task"`.
  - Or run in interactive CLI REPL mode for back-and-forth conversation.
- **Safety & Containment**: Encapsulated `Workspace` class with lexical & realpath containment checks to prevent escaping the workspace directory. Interactive approval prompts before executing destructive tools.
- **Dependency Injection**: Pass workspace and permission gates directly to tools and agent loop.

---

## Quick Start

### Install a release

On macOS or Linux, install the latest tagged release with:

```bash
curl -fsSL https://raw.githubusercontent.com/Mitriyweb/mini-agent/main/install.sh | bash
```

The installer places `mini-agent` in `~/.local/bin`. Add that directory to your
`PATH` if it is not already available. To install a specific tag:

```bash
curl -fsSL https://raw.githubusercontent.com/Mitriyweb/mini-agent/main/install.sh | MINI_AGENT_VERSION=v0.1.0 bash
```

Project page: https://mitriyweb.github.io/mini-agent/

Releases are built automatically for macOS (Intel and Apple Silicon), Linux
(x64 and arm64), and Windows (x64) when a `v*` tag is pushed.

### 1. Ensure `model-router` is running
```bash
# In the root model-router directory:
bun run start
```

### 2. Install & Build `mini-agent`

```bash
bun install
bun run build
```

To bump the package version:

```bash
bun run bump:version -- patch
```

Use `minor` or `major` instead of `patch` when appropriate. The version is
stored in `package.json` and is used by the CLI `--version` output.

To bump the version, create a tag, and publish a GitHub Release:

```bash
bun run release -- patch
```

This requires authenticated GitHub CLI (`gh`) and a clean staging area.

### 3. Run `mini-agent`

#### Single CLI Task:
```bash
bun run start -- -y "Check package.json and describe the project"
```

#### Interactive REPL Mode:
```bash
bun run start
```

#### Options & Flags:
```bash
bun run start -- [options] [task...]

Options:
  -y, --auto-approve, --yes   Auto-approve tool execution without interactive prompt
  --dir <path>                Set the project workspace directory
  --model <model_id>          Override model ID (default: model-router-auto)
  --url <base_url>            Override API base URL (default: http://localhost:8787/v1)
  --max-steps <number>        Max execution steps (default: 30)
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_BASE_URL` | `http://localhost:8787/v1` | OpenAI API endpoint |
| `MODEL` | `model-router-auto` | Model ID for completion |
| `OPENAI_API_KEY` | `dummy` | API Key for model-router / OpenAI |
| `AUTO_APPROVE` | `false` | Set to `true` to skip permission prompts |

---

## Available Tools

- `read`: Read file contents with offset and line limits.
- `write`: Create or overwrite a file inside the workspace.
- `edit`: Replace unique text fragments in a file (handles CRLF/LF line endings).
- `patch`: Apply multiple hunk replacements to a file.
- `delete`: Delete a file inside the workspace.
- `glob`: Search files by wildcard/glob pattern.
- `grep`: Search file contents using regular expressions.
- `bash`: Run shell commands in the workspace root.
- `check`: Run syntax/type checks (`bun x tsc --noEmit` or `bun run check`).
- `fetch`: Fetch HTTP/HTTPS web documents.
- `todo`: Maintain structured task tracking lists.

---

## Standalone Project Extraction

`mini-agent` is stored with a dedicated `package.json`. You can move or copy the entire `mini-agent/` directory into a separate repository or location at any time:

```bash
cp -r mini-agent /path/to/new-repo
cd /path/to/new-repo
bun install
bun run build
bun run start -- -y "Your task"
```

---

## Tests & Verification

To run `mini-agent` unit tests and type checks:

```bash
bun test
# or
node --test tests/*.test.js
```

---

## Standalone Project Extraction

`mini-agent` is stored in its own folder (`mini-agent/`) with a dedicated `package.json`. You can move or copy the entire `mini-agent/` directory out of `model-router` into a separate repository at any time:

```bash
cp -r mini-agent /path/to/new-repo
cd /path/to/new-repo
bun install
bun start -- -y "Your task"
```
