# OpenSpec Project Overview: mini-agent

## Project Information
- **Name**: `mini-agent`
- **Version**: `0.1.15`
- **Description**: A small, modular, self-contained coding agent harness compatible with `model-router` and OpenAI-compatible completions endpoints.

## Architecture & Domain Subsystems
The `openspec/specs/` directory contains component specifications for each domain of the codebase:

1. **`specs/agent/`**: Core agent loop lifecycle (`runAgent`), message history, step limiting, and customizations.
2. **`specs/tools/`**: Built-in tool suite (`read`, `write`, `edit`, `patch`, `delete`, `glob`, `grep`, `bash`, `check`, `fetch`, `todo`, `openspec`).
3. **`specs/permissions/`**: Security permission rules (`deny > allow exact > allow mask`), interactive prompts, and store persistence.
4. **`specs/workspace/`**: Path containment, git root resolution, and sandbox isolation.
5. **`specs/providers/`**: Dynamic model discovery, provider registry (Router, OpenAI, Anthropic, Google), and client creation.

## OpenSpec Convention
- Each domain specification directory contains:
  - `spec.md`: Detailed functional specification, domain requirements, and scenarios in Markdown format.
  - `spec.yaml`: Machine-readable OpenAPI/OpenSpec specification compatible with the built-in `openspec` tool.
- Pending or proposed specification changes are tracked in `openspec/changes/`.
