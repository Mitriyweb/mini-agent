# custom-providers Specification

## Purpose

Let users declare arbitrary OpenAI-compatible LLM router endpoints (e.g. `llmlite`) in configuration and use them by name for completions and model discovery, without modifying built-in providers.

## Requirements

### Requirement: User-Declared Custom Providers

The system MUST support a `providers` map in the agent configuration file where each key is a provider ID and each value declares an OpenAI-compatible endpoint. A custom provider entry MUST support `name`, `baseURL`, `apiKey` or `apiKeyEnvVar`, `defaultModel`, optional `fallbackModels`, and a `models` discovery configuration. Entries MUST be usable anywhere a built-in provider ID is accepted (`provider` config, `PROVIDER` env, `--provider` flag, interactive provider selection).

#### Scenario: Configure and select a custom router

- **WHEN** the config file declares `providers.llmlite` with a `baseURL` and `defaultModel`, and the user selects provider `llmlite`
- **THEN** the agent creates a client that sends chat completions to that `baseURL` using the resolved API key and `defaultModel` (or the user/CLI-specified model)

#### Scenario: API key resolution order for custom providers

- **WHEN** a custom provider defines both `apiKey` and `apiKeyEnvVar`, or only one of them
- **THEN** an explicitly supplied key wins, then the entry's `apiKey`, then the environment variable named by `apiKeyEnvVar`, then the shared fallback key (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`dummy`)

### Requirement: Configurable Model Discovery

Each custom provider MUST support a `models` configuration that determines how available models are listed. Supported discovery methods MUST include: (a) OpenAI-compatible model listing against the provider `baseURL`, (b) a custom HTTP endpoint returning a model list with configurable response mapping, and (c) a static list of models. When discovery is not configured, the system MUST default to OpenAI-compatible listing. When discovery fails or returns no models, `getModels` MUST fall back to the provider's `defaultModel`.

#### Scenario: OpenAI-compatible discovery

- **WHEN** a custom provider uses the default discovery method and its `baseURL` exposes an OpenAI-compatible models endpoint
- **THEN** `getModels` returns the models reported by that endpoint

#### Scenario: Custom endpoint discovery

- **WHEN** a custom provider configures a custom models endpoint (path or URL) with a response mapping
- **THEN** `getModels` fetches that endpoint with the provider's credentials and maps the response into the model list

#### Scenario: Static model list

- **WHEN** a custom provider configures a static `models` list
- **THEN** `getModels` returns exactly that list without any network request

#### Scenario: Discovery failure falls back to default model

- **WHEN** model discovery for a custom provider fails (endpoint unreachable, non-2xx, malformed response)
- **THEN** `getModels` returns a single-entry list containing the provider's `defaultModel` and does not throw

### Requirement: Custom Provider Config Validation

The system MUST validate custom provider entries when loading configuration and reject invalid entries with a clear error before the agent starts. Validation MUST check: provider IDs are non-empty and unique (and do not collide with reserved built-in IDs unless intentionally overriding is disallowed — collisions MUST be rejected), `baseURL` is present and a valid URL, `defaultModel` is non-empty, `apiKeyEnvVar` names a valid environment variable, `fallbackModels` is a list of strings, and the `models` discovery config is one of the supported shapes.

#### Scenario: Reject duplicate provider ID

- **WHEN** the config declares two entries that resolve to the same provider ID, or an ID equal to a built-in provider ID
- **THEN** configuration loading fails with an error identifying the conflicting ID

#### Scenario: Reject missing baseURL

- **WHEN** a custom provider entry omits `baseURL`
- **THEN** configuration loading fails with an error identifying the provider entry

#### Scenario: Reject invalid models discovery config

- **WHEN** a custom provider's `models` config does not match any supported discovery shape
- **THEN** configuration loading fails with an error describing the accepted shapes

### Requirement: Custom Providers in Interactive Selection

Interactive provider and model selection MUST include configured custom providers alongside built-ins, and model selection for a custom provider MUST use its configured discovery method.

#### Scenario: Custom provider appears in provider picker

- **WHEN** custom providers are configured and the interactive provider picker runs
- **THEN** each custom provider is listed with its configured `name` and ID

#### Scenario: Model picker uses custom discovery

- **WHEN** the user selects a custom provider and proceeds to model selection
- **THEN** the listed models come from the provider's configured discovery method, with `defaultModel` as the default choice
