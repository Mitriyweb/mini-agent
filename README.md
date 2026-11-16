# mini-agent

A lightweight, modular coding agent harness supporting multi-provider LLMs (**Model Router**, **OpenAI**, **Anthropic**, **Google Gemini**), migrated to **TypeScript** and **ESM**.

---

## Features

- **Multi-Provider Architecture**:
  - **Model Router** (default: `http://localhost:8787/v1` with `model-router-auto`).
  - **Direct Provider Mode**: Work directly with **OpenAI**, **Anthropic**, **Google Gemini**, **Z.AI**, or OpenAI-compatible endpoints bypassing `model-router`.
  - **Dynamic Model Discovery**: Fetches real available models directly from provider APIs.
  - **Gzip Transport**: JSON request bodies are gzip-encoded (`Content-Encoding: gzip`) and `Accept-Encoding: gzip` is advertised on every provider call; gzip-encoded responses are transparently decompressed.
- **TypeScript & ESM**: Fully typed codebase targeting Node.js >= 20 and Bun.
- **Configurable Observability & Logging**:
  - `off`: Complete quiet execution.
  - `normal`: Standard workflow execution feedback.
  - `verbose`: Detailed debugging including prompt metadata, request duration, token usage, and skill resolution, with safe secret redaction.
  - Errors are always echoed to the console (`stderr`) even when file logging is enabled, so failures are never silent.
- **Independent Token & Cost Accounting**:
  - Collects token usage (input/prompt, output/completion, total).
  - Configurable pricing per 1 million tokens (global default or per-model).
  - Operates independently from logging level.
- **Flexible Skill Controls**:
  - Fine-grained controls with `enabled`, `allow`, and `deny` rules.
  - `deny` rules take deterministic precedence over `allow` rules.
- **System Prompt Management**:
  - Toggle standard system prompts or load custom prompt files.
  - Keeps custom instructions, skills, and workflows separate.
- **Durable Runs**:
  - Start an explicit run with a stable ID and resumable checkpoint state.
  - Persist redacted state and append-only lifecycle events under `.mini-agent/runs/`.
- **Persistent Project Memory**:
  - Keep project-level notes across sessions in `.mini-agent/memory.md`.
  - Add entries from the CLI or inspect accumulated knowledge with `mini-agent memory show`.
- **Quality Gates**:
  - Run configured project checks through the normal shell permission flow.
  - Block successful completion when a required check fails, while allowing optional checks to be skipped.
- **Deterministic OpenSpec Orchestrator**:
  - Automatically execute an entire OpenSpec change sequentially (`mini-agent apply <change-name>`).
  - Zero LLM tokens consumed for orchestration logic (parsing, selection, and scheduling).
  - Validates tasks with Quality Gates before marking them completed in `tasks.md`.
  - Resilient execution with bounded retries and resumption support.
- **Modular Local Tools**: Includes file & workspace operations (`read`, `write`, `edit`, `patch`, `delete`, `glob`, `grep`, `bash`, `check`, `fetch`, `todo`, `openspec`), child-agent delegation (`delegate`), and CLI reviewers (`claude_review`, `codex_review`).
- **Configurable Subagent Delegation**: Opt-in child agents with per-task read-only or write access, bounded concurrency, step limits, and cancellation.
- **Built-in Review Skills**: `semantic-review`, `claude-review`, and `codex-review` skills for evidence-based code review, optionally delegated to the installed Claude or Codex CLI.

---

## Installation

Install the latest binary from the GitHub release assets:

```bash
curl -fsSL https://raw.githubusercontent.com/Mitriyweb/mini-agent/main/install.sh | bash
```

This script downloads the matching `mini-agent` binary for your OS/architecture and installs it into `~/.local/bin` by default. Add `~/.local/bin` to your `PATH` if you want to run `mini-agent` directly from any shell.

---

## Quick Start Examples

### Standard Task Execution
```bash
mini-agent "Fix the failing tests"
```

### Deterministic OpenSpec Change Execution (`apply`)
```bash
mini-agent apply add-user-authentication
```

Runs the entire OpenSpec change sequentially one task at a time. The orchestrator:
1. Loads `tasks.md`, `proposal.md`, `design.md`, and relevant specs from `openspec/changes/<change-name>/`.
2. Selects the next eligible incomplete task whose dependencies are satisfied.
3. Prepares a focused context prompt for the agent runtime.
4. Executes the task using `runAgent()` and validates results with Quality Gates.
5. Marks the task complete `- [x]` in `tasks.md` only after successful validation.
6. Retries failed tasks up to `--max-retries` (default: 3) with error and quality gate feedback.

### Durable Run and Resume
```bash
mini-agent run "Implement feature X"
# Run ID: <run-id>

mini-agent resume <run-id>
```

Explicit runs persist their redacted checkpoint state in `.mini-agent/runs/<run-id>/`. A resumed run restores the recorded conversation and skips tool calls that were already completed. Completed runs cannot be resumed.

### Persistent Project Memory
```bash
mini-agent memory show
mini-agent memory add "Remember to preserve backward compatibility when updating the CLI"
```

Project memory is stored in `.mini-agent/memory.md` and is automatically included in the built-in system prompt so the agent can carry forward important context between sessions. Memory content is bounded to the latest entries and trimmed to fit the configured size limits.

### Debug Execution
```bash
mini-agent --log-level verbose "Fix the failing tests"
```

### Cost Accounting Mode
```bash
mini-agent --cost-tracking "Refactor authentication"
```

### Specific Skills Allowed
```bash
mini-agent --skills git,code-review "Review this PR"
```

### Skills Completely Disabled
```bash
mini-agent --no-skills "Analyze this code"
```

---

## Options & Flags

```bash
mini-agent [options] [task...]
mini-agent run [options] "task..."
mini-agent resume [options] <run-id>
mini-agent apply [options] <change-name>
mini-agent memory show
mini-agent memory add "new knowledge"

Options:
  -y, --auto-approve, --yes   Auto-approve tool execution without interactive prompt
  --dir <path>                Set the project workspace directory
  -p, --provider <id>         Override LLM provider (router, openai, anthropic, google, zai)
  --model <model_id>          Override model ID (default: model-router-auto for router)
  --url <base_url>            Override API base URL (default: http://localhost:8787/v1)
  --max-steps <number>        Max execution steps (default: 30)
  --max-retries <number>      Max retries per task in apply mode (default: 3)
  --retry                     Enable automatic retry on transient LLM errors (default)
  --no-retry                  Disable automatic retry on transient LLM errors
  --retry-attempts <number>   Max retry attempts on transient LLM errors (default: 3)
  --log-level <level>         Set log level: off, normal, verbose (default: normal)
  --cost-tracking             Enable LLM token usage & cost tracking
  --no-cost-tracking          Disable LLM token usage & cost tracking
  --no-skills                 Disable all skills loading and prompt injection
  --skills <skill1,skill2>    Comma-separated list of allowed skills
  --system-prompt             Enable standard built-in system prompt (default)
  --no-system-prompt          Disable standard built-in system prompt
  --config <path>             Path to configuration YAML/JSON file
  --permission-mode <mode>    Permission mode: normal (default), bypass (aliases: yolo, dangerous)
  --bypass                    Shortcut for --permission-mode bypass
  -v, --version               Show the installed version
  -h, --help                  Show this help text
```

---

## Configuration File & Precedence

`mini-agent` automatically loads `mini-agent.config.yaml`, `mini-agent.config.json`, `.mini-agentrc.yaml`, or `.mini-agentrc.json` from the workspace root (or from an explicit path specified with `--config`).

### Configuration Precedence Order
Rules are evaluated in strict priority order (CLI arguments always take highest precedence):
```
defaults
  ↓
config file
  ↓
profile preset (sits between file config and env for additive role-based overrides)
  ↓
environment variables
  ↓
CLI arguments
```

Profiles (e.g., `--profile developer`) apply role-based defaults on top of file config but beneath environment variables and CLI flags, allowing you to select a development posture without overriding explicit command-line choices.

### Configuration Example (`mini-agent.config.yaml`)
```yaml
logging:
  level: normal # off | normal | verbose

cost_tracking:
  enabled: true
  currency: USD

  pricing:
    input_per_1m_tokens: 0.0
    output_per_1m_tokens: 0.0

  models:
    model-router-auto:
      input_per_1m_tokens: 1.0
      output_per_1m_tokens: 3.0
    gpt-4o:
      input_per_1m_tokens: 2.5
      output_per_1m_tokens: 10.0

skills:
  enabled: true
  allow:
    - git
    - code-review
  deny:
    - dangerous-skill

system_prompt:
  enabled: true
  path: "" # Optional path to custom prompt markdown file

quality_gates:
  enabled: true
  gates:
    - id: test
      name: Unit tests
      command: bun test
      required: true
    - id: typecheck
      command: bun x tsc --noEmit
      required: true
    - id: optional-report
      required: false # A missing command is reported as skipped

retry:
  enabled: true
  maxAttempts: 3                # Number of retry attempts for transient errors
  initialDelayMs: 1000          # Initial backoff delay in milliseconds
  backoffFactor: 2              # Exponential backoff multiplier (delay doubles each attempt)
  maxDelayMs: 30000             # Maximum delay between retries (caps exponential growth)

subagents:
  enabled: false                # Opt-in child-agent delegation (default: off)
  max_concurrency: 4            # Max child tasks running at once per delegate call
  max_steps: 30                 # Default per-child step limit
  allow_nested: false           # Allow write-capable children to delegate further

providers:
  llmlite:                      # Any provider ID; usable via provider:, PROVIDER, --provider, /provider
    name: LLM Lite              # Optional display name (defaults to the ID)
    baseURL: https://llmlite.example.com/v1   # Required; OpenAI-compatible endpoint
    apiKeyEnvVar: LLMLITE_API_KEY             # Env var holding the key (recommended)
    # apiKey: literal-key                    # Optional literal key (apiKeyEnvVar preferred)
    defaultModel: auto           # Required; used when no model is selected
    fallbackModels: [model-a]    # Optional capacity failover models
    models:                      # Optional model discovery (default: openai-compatible)
      type: openai-compatible    # GET {baseURL}/models
      # type: endpoint           # Custom HTTP endpoint returning a model list
      #   url: /api/models      #   Absolute URL or baseURL-relative path
      #   itemsPath: data.items #   Dotted path to the array in the JSON response
      #   idField: model        #   Field used as the model id (default: id)
      #   nameField: label      #   Field used as the display name (default: name)
      # type: static            # No network; return a fixed list
      #   list: [auto, { id: pro, name: Pro Model }]
```

### Custom Providers

The `providers` map lets you register any OpenAI-compatible router or gateway (e.g. `llmlite`) under a name of your choice. Custom providers work everywhere a built-in provider ID does: `provider:` in config, the `PROVIDER` env var, `--provider`, and the interactive `/provider` and `/model` commands.

Each entry requires `baseURL` and `defaultModel`. API keys resolve in this order: explicit option → entry `apiKey` → the env var named by `apiKeyEnvVar` → `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` → `dummy`. Prefer `apiKeyEnvVar` over a literal `apiKey` so secrets stay out of config files.

Model discovery (`models`) supports three methods:

- `openai-compatible` (default): lists models from the OpenAI-compatible `GET {baseURL}/models` endpoint.
- `endpoint`: fetches a custom URL (absolute or relative to `baseURL`) and maps the JSON response via `itemsPath`, `idField`, and `nameField`.
- `static`: returns a fixed list with no network request.

If discovery fails or returns nothing, the provider falls back to `defaultModel`. Provider IDs must be unique and cannot collide with built-ins (`router`, `openai`, `anthropic`, `google`, `zai`); invalid entries fail fast at startup with a descriptive error.

### Retry Policy

By default, `mini-agent` automatically retries transient LLM errors with deterministic exponential backoff:

- **Retryable errors** (transient): HTTP 408, 429 (rate limit), 500, 502, 503, 504, network timeouts and disconnects
- **Non-retryable errors** (fail-fast): HTTP 400 (bad request), 401/403 (auth), 404 (not found), 413 (context length exceeded)
- **Retry-After headers**: Respected for 429 and 503 responses via standard `Retry-After` header (seconds or HTTP-date) or non-standard `retry-after-ms` header (milliseconds), capped at `maxDelayMs`
- **Exponential backoff**: `delay = Math.min(maxDelayMs, initialDelayMs * 2^(attempt-1))` with no jitter (deterministic for repeatability)
  - Example with defaults (initial=1000ms, factor=2, max=30000ms):
    - Attempt 1→2: 1000ms delay
    - Attempt 2→3: 2000ms delay
    - Attempt 3→4: 4000ms delay
    - Attempt 4→5: 8000ms delay
    - Attempt 5→6: 16000ms delay (capped at 30000ms max)
- **Fallback models**: Used only for transient capacity errors (503); permanent errors fail immediately
- **Signal-aware**: Cancellation signals interrupt retries and in-flight delays

CLI flags:
- `--retry` enables retry (default)
- `--no-retry` disables retry (1 attempt per model)
- `--retry-attempts <n>` overrides `maxAttempts` for this run

Note: `--max-retries` is distinct and controls OpenSpec task retries on permanent failures.

### Permission Modes

`permission_mode` selects how tool approvals behave for the session. The default `normal` mode prompts for sensitive operations. `bypass` mode (aliases `yolo`, `dangerous`) auto-approves every tool prompt — including CLI review bundle transmission — and skips configured quality gates (reported as `skipped`, never executed). Deny permission rules and workspace/git-root containment still apply in bypass mode, and read-only subagents remain read-only regardless of mode.

Set it via `permission_mode: bypass` in the config file, `MINI_AGENT_PERMISSION_MODE`, `--permission-mode bypass` / `--bypass` on the CLI, or in-session with `/bypass`, `/yolo`, `/dangerous`, `/normal`, and `/mode`. The interactive approval dialog also offers a session-scoped bypass option. This is stronger than `-y`/`--auto-approve`, which only suppresses prompts and still runs quality gates.

### Quality Gates

Quality gates are disabled by default. Set `quality_gates.enabled: true` to run explicit `gates`, or omit `gates` to discover supported `test`, `check`, `build`, and `verify` scripts from `package.json`.

Each gate uses a kebab-case `id`, optional display `name`, `command`, `required` flag, and optional `timeout_ms`. Results include status, exit code, stdout, stderr, and duration. A failed required gate is returned to the agent for remediation and prevents a successful completion until it passes.

### Subagent Delegation

Child-agent delegation is **disabled by default**. Enable it with `subagents.enabled: true` (or `MINI_AGENT_SUBAGENTS_ENABLED=true`) to let the agent delegate bounded subtasks through the `delegate` tool.

Each delegated task declares a required access mode:

- `read-only` — the child gets a restricted registry with only workspace inspection tools (`read`, `glob`, `grep`). It cannot modify files, run shell commands, or delegate further.
- `write` — the child gets the full tool registry and the normal workspace-containment and permission-approval flow. Interactive approval prompts from concurrent write children are serialized so they never compete for the terminal.

Behavior and limits:

- Every child starts with **fresh conversation state** (no parent history) but shares the parent's workspace, provider, model, and configuration.
- `max_concurrency` (default `4`) bounds how many children run at once; results are reported per task with `completed`, `failed`, or `interrupted` status plus usage summaries.
- `max_steps` (default `30`) caps each child's steps; a task can override it with its own `maxSteps`.
- Parent cancellation propagates to running children, which report `interrupted`.
- `allow_nested` (default `false`) lets write-capable children delegate further, bounded by an internal depth limit. Read-only children can never delegate.
- Children do not run quality gates or external review.

> **Shared-workspace warning:** concurrent `write` children modify the same workspace. Only batch tasks that are independent — there are no worktrees or conflict detection. If two children edit the same file, last write wins.

### Review Skills

Three built-in skills are available when skills are enabled (workspace or user skills of the same name take precedence):

- `/semantic-review` — delegates a read-only child agent to review the requested scope (default: current uncommitted changes) and report findings with severity, file/line evidence, and explicit disclosure of incomplete evidence. Requires `subagents.enabled` for the delegated path; the agent will report if delegation is unavailable.
- `/claude-review` — sends a **redacted** review bundle to the installed `claude` CLI for an independent read-only review.
- `/codex-review` — same, via the installed `codex` CLI.

CLI reviewer details:

- **Prerequisites:** the corresponding CLI (`claude` or `codex`) must be installed and authenticated. Missing or unauthenticated CLIs fail explicitly — no silent fallback to another reviewer.
- **Data handling:** only a redacted review bundle (credentials and sensitive paths removed, size-limited) leaves the machine, delivered over stdin from an isolated temporary directory. The CLI runs non-interactively with read-only flags (`claude -p --permission-mode plan`; `codex exec --sandbox read-only`) and cannot access the original workspace.
- **Approval:** transmitting the bundle requires the normal tool-approval flow (`claude_review` / `codex_review` tools). Denied approval means the review does not run.
- **Failures:** non-zero exit, timeout (~120s), cancellation, or empty output is reported explicitly.
- **Findings format:** severity, file/line location, reasoning, evidence; confirmed defects are distinguished from uncertainty.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` / `MINI_AGENT_LOG_LEVEL` | `normal` | Logging verbosity (`off`, `normal`, `verbose`) |
| `MINI_AGENT_COST_TRACKING` | `false` | Enable/disable cost tracking (`true`/`false`) |
| `MINI_AGENT_SKILLS_ENABLED` | `true` | Enable/disable skills discovery (`true`/`false`) |
| `MINI_AGENT_SYSTEM_PROMPT_ENABLED` | `true` | Enable/disable standard system prompt (`true`/`false`) |
| `MINI_AGENT_RETRY` | `true` | Enable/disable automatic retry on transient errors (`true`/`false`) |
| `MINI_AGENT_RETRY_ATTEMPTS` | `3` | Max retry attempts on transient LLM errors |
| `MINI_AGENT_SUBAGENTS_ENABLED` | `false` | Enable/disable child-agent delegation (`true`/`false`) |
| `MINI_AGENT_SUBAGENTS_MAX_CONCURRENCY` | `4` | Max concurrent child tasks per delegate call |
| `MINI_AGENT_SUBAGENTS_MAX_STEPS` | `30` | Default per-child step limit |
| `MINI_AGENT_SUBAGENTS_ALLOW_NESTED` | `false` | Allow write-capable children to delegate (`true`/`false`) |
| `PROVIDER` | `router` | Default LLM provider (`router`, `openai`, `anthropic`, `google`, `zai`) |
| `ZAI_API_KEY` | | API key for Z.AI |
| `ZAI_BASE_URL` | `https://api.z.ai/api/coding/paas/v4` | Base URL for Z.AI Chat Completions API |
| `ZAI_MODEL` | `glm-5.3-highspeed` | Default model for Z.AI |
| `MODEL` | `model-router-auto` | Default model ID |
| `OPENAI_BASE_URL` | `http://localhost:8787/v1` | Base URL for OpenAI/Router |
| `OPENAI_API_KEY` | `dummy` | API key for OpenAI / Model Router |
| `AUTO_APPROVE` | `false` | Set to `true` to skip permission prompts |
| `MINI_AGENT_PERMISSION_MODE` | `normal` | Permission mode: `normal` or `bypass` (aliases `yolo`, `dangerous`) |

---

## Programmatic API Usage

Settings are fully available when creating or running agents programmatically:

```ts
import { runAgent, Workspace, createPermissions, createProvider } from 'mini-agent';

const workspace = await Workspace.open(process.cwd());
const provider = createProvider({ provider: 'openai', model: 'gpt-4o' });
const permissions = createPermissions({ autoApprove: true }, workspace);

const result = await runAgent({
  task: 'Fix lint errors in src/',
  provider,
  permissions,
  workspace,
  logging: { level: 'verbose' },
  costTracking: {
    enabled: true,
    currency: 'USD',
    pricing: { input_per_1m_tokens: 2.5, output_per_1m_tokens: 10.0 },
  },
  skillsConfig: {
    enabled: true,
    allow: ['git', 'code-review'],
    deny: ['dangerous-skill'],
  },
  systemPromptConfig: {
    enabled: true,
  },
});

console.log(result.text);
if (result.usageSummary) {
  console.log(`Total cost: $${result.usageSummary.estimatedCost}`);
}
```

---

## REPL Commands

In interactive mode (`mini-agent`), the following built-in slash commands are available:

| Command | Description |
|---|---|
| `/provider [id]` | Show, select, or change LLM provider |
| `/model [model_id]` | Fetch available models and select active model |
| `/log-level [off\|normal\|verbose]` | Change the current session log level |
| `/cost-tracking [on\|off\|toggle]` | Toggle LLM cost tracking for this session |
| `/system-prompt [on\|off\|toggle]` | Toggle the built-in system prompt for this session |
| `/help` | Show workflow, skill, provider, and command help |
| `/workflows` | List available workflow shortcuts |
| `/skills` | List active skills |
| `/max-steps <number>` | Set maximum execution steps for new tasks |
| `/auto-approve [on\|off\|toggle]` | Toggle tool approval prompts |
| `/mode [normal\|bypass]` | Show or switch permission mode |
| `/bypass`, `/yolo`, `/dangerous` | Switch to bypass mode for this session |
| `/normal` | Switch back to normal permission mode |
| `/exit`, `/quit` | Exit the interactive session |

> In the interactive session, provider and model changes should be performed through slash commands that start with `/`. The environment variables `PROVIDER`, `MODEL`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY` remain useful as defaults for a new session, but the runtime controls are the slash commands above.

---

## Tests & Verification

To run tests and verify the project:

```bash
bun test
bun run check
```
