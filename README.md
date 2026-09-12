# mini-agent

A lightweight, modular coding agent harness supporting multi-provider LLMs (**Model Router**, **OpenAI**, **Anthropic**, **Google Gemini**), migrated to **TypeScript** and **ESM**.

---

## Features

- **Multi-Provider Architecture**:
  - **Model Router** (default: `http://localhost:8787/v1` with `model-router-auto`).
  - **Direct Provider Mode**: Work directly with **OpenAI**, **Anthropic**, **Google Gemini**, or OpenAI-compatible endpoints bypassing `model-router`.
  - **Dynamic Model Discovery**: Fetches real available models directly from provider APIs.
- **TypeScript & ESM**: Fully typed codebase targeting Node.js >= 20 and Bun.
- **Configurable Observability & Logging**:
  - `off`: Complete quiet execution.
  - `normal`: Standard workflow execution feedback.
  - `verbose`: Detailed debugging including prompt metadata, request duration, token usage, and skill resolution, with safe secret redaction.
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
- **Modular Local Tools**: Includes file & workspace operations (`read`, `write`, `edit`, `patch`, `delete`, `glob`, `grep`, `bash`, `check`, `fetch`, `todo`, `openspec`).

---

## Quick Start Examples

### Standard Task Execution
```bash
mini-agent "Fix the failing tests"
```

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

Options:
  -y, --auto-approve, --yes   Auto-approve tool execution without interactive prompt
  --dir <path>                Set the project workspace directory
  -p, --provider <id>         Override LLM provider (router, openai, anthropic, google)
  --model <model_id>          Override model ID (default: model-router-auto for router)
  --url <base_url>            Override API base URL (default: http://localhost:8787/v1)
  --max-steps <number>        Max execution steps (default: 30)
  --log-level <level>         Set log level: off, normal, verbose (default: normal)
  --cost-tracking             Enable LLM token usage & cost tracking
  --no-cost-tracking          Disable LLM token usage & cost tracking
  --no-skills                 Disable all skills loading and prompt injection
  --skills <skill1,skill2>    Comma-separated list of allowed skills
  --system-prompt             Enable standard built-in system prompt (default)
  --no-system-prompt          Disable standard built-in system prompt
  --config <path>             Path to configuration YAML/JSON file
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
environment variables
  ↓
CLI arguments
```

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
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` / `MINI_AGENT_LOG_LEVEL` | `normal` | Logging verbosity (`off`, `normal`, `verbose`) |
| `MINI_AGENT_COST_TRACKING` | `false` | Enable/disable cost tracking (`true`/`false`) |
| `MINI_AGENT_SKILLS_ENABLED` | `true` | Enable/disable skills discovery (`true`/`false`) |
| `MINI_AGENT_SYSTEM_PROMPT_ENABLED` | `true` | Enable/disable standard system prompt (`true`/`false`) |
| `PROVIDER` | `router` | Default LLM provider (`router`, `openai`, `anthropic`, `google`) |
| `MODEL` | `model-router-auto` | Default model ID |
| `OPENAI_BASE_URL` | `http://localhost:8787/v1` | Base URL for OpenAI/Router |
| `OPENAI_API_KEY` | `dummy` | API key for OpenAI / Model Router |
| `AUTO_APPROVE` | `false` | Set to `true` to skip permission prompts |

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

In interactive mode (`mini-agent`), the following built-in commands are available:

| Command | Description |
|---|---|
| `/provider [id]` | Show, select, or change LLM provider |
| `/model [model_id]` | Fetch available models and select active model |
| `/help` | Show workflow, skill, provider, and command help |
| `/workflows` | List available workflow shortcuts |
| `/skills` | List active skills |
| `/max-steps <number>` | Set maximum execution steps for new tasks |
| `/auto-approve [on\|off]` | Toggle tool approval prompts |
| `/exit`, `/quit` | Exit the interactive session |

---

## Tests & Verification

To run tests and verify the project:

```bash
bun test
bun run check
```
