# OpenSpec: Providers Domain Specification

## Purpose
Manage LLM completion endpoints, provider registry, and client generation with deterministic retry policies for transient errors, fail-fast semantics for permanent errors, signal-aware cancellation, and external review interface.

## Overview
The `providers` domain manages LLM completion endpoints, ProviderRegistry, and client generation (`router`, `openai`, `anthropic`, `google`) with deterministic retry policies for transient errors, and supports external review execution in a separate context.

## Requirements

### Requirement: Dynamic Model Discovery
Providers MUST support model discovery via `getModels()` or return default fallback models when discovery fails.

#### Scenario: Router Model Listing
- **Given** model-router endpoint
- **When** `getModels()` is invoked
- **Then** list of available models is returned.

### Requirement: Deterministic Transient Error Retry
The LLM provider client MUST deterministically retry transient connection, timeout, and server errors (including HTTP 408, 429 rate limits, HTTP 500/502/503/504 server errors, and socket drops ECONNRESET, ETIMEDOUT, ECONNREFUSED, ENOTFOUND, EAI_AGAIN) without delegating retries to underlying SDK defaults.

#### Scenario: Server 503 Service Unavailable triggers bounded retry
- **Given** an active provider client and transient server 503 error
- **When** the model completion request fails with HTTP 503 or UNAVAILABLE
- **Then** the client retries the request up to the configured maximum attempts using deterministic backoff

#### Scenario: Connection reset or network timeout triggers retry
- **Given** an active provider client
- **When** the request fails due to network error codes ECONNRESET, ETIMEDOUT, or fetch timeout
- **Then** the client retries the request up to the configured retry limit

#### Scenario: HTTP 429 Rate Limit triggers retry respecting Retry-After
- **Given** an active provider client and HTTP 429 response with a Retry-After header
- **When** the request fails with HTTP 429
- **Then** the client delays execution according to the Retry-After value up to the configured ceiling and retries

### Requirement: Fail-Fast on Non-Transient and Context Length Errors
The LLM provider client MUST NOT retry requests that fail due to client errors, invalid parameters, authentication failures, or context window overflow (HTTP 400, 401, 403, 404, 413, 422, 501, or prompt/context length exceeded). Explicit HTTP status codes SHALL outrank substring matching.

#### Scenario: HTTP 400 Bad Request fails immediately
- **Given** an active provider client
- **When** the provider returns HTTP 400 Bad Request (even if the body mentions timeout)
- **Then** the error is thrown immediately after exactly 1 attempt without retrying

#### Scenario: Context length exceeded fails immediately
- **Given** an active provider client
- **When** the request fails with HTTP 413 or error message matching context length or token limits
- **Then** the client fails immediately without repeating the identical oversized prompt

#### Scenario: Authentication and authorization failures fail immediately
- **Given** an active provider client
- **When** the provider returns HTTP 401 Unauthorized or HTTP 403 Forbidden
- **Then** the error is raised immediately after 1 attempt without retry

### Requirement: Configurable Retry Policy and Validation
The runtime MUST allow enabling, disabling, and tuning retry parameters via configuration and CLI overrides, and MUST validate that retry parameters conform to valid positive bounds.

#### Scenario: Disabling retries via config or CLI
- **Given** retry is disabled via configuration (`retry.enabled: false`) or CLI flag (`--no-retry`)
- **When** a transient error occurs during a completion request
- **Then** exactly 1 attempt is performed and the error is thrown immediately without retrying

#### Scenario: Customizing retry bounds and backoff
- **Given** configuration specifying `maxAttempts: 2`, `initialDelayMs: 500`, and `backoffFactor: 2`
- **When** persistent transient errors occur
- **Then** exactly 2 attempts are made with a 500ms backoff between attempts

#### Scenario: Rejecting invalid retry configuration
- **Given** configuration with negative `maxAttempts` or `backoffFactor` less than 1
- **When** configuration is validated at runtime startup
- **Then** a configuration validation error is thrown

### Requirement: Signal-Aware Request and Backoff Cancellation
The LLM provider client MUST propagate AbortSignal to both active HTTP completion requests and backoff sleep delays, terminating immediately when aborted.

#### Scenario: Cancellation during backoff delay
- **Given** an active retry backoff sleep
- **When** the AbortSignal is triggered
- **THEN** the delay is cancelled immediately and an abort error is raised without completing remaining retries

### Requirement: Provider Error Classification for External Review
The provider infrastructure MUST classify errors using consistent transient/permanent categorization to enable reuse of retry logic in external review execution.

#### Scenario: Review retry uses provider classification
- **Given** external review execution with retry-on-transient policy
- **When** review request fails
- **Then** the same provider error classification (transient vs permanent) is applied to decide retry behavior

### Requirement: Gzip-Compress Provider Request Bodies
Provider API requests with a body MUST send that body gzip-encoded and identify the encoding with the `Content-Encoding: gzip` header.

#### Scenario: Completion request is sent with gzip encoding
- **WHEN** a provider client sends a completion request with a JSON body
- **THEN** the request body is gzip-encoded and the provider receives the original JSON after decompression

#### Scenario: Bodyless provider request is sent
- **WHEN** a provider client sends a request without a body
- **THEN** it does not add a `Content-Encoding: gzip` header

### Requirement: Transparently Handle Gzip Provider Responses
Provider API requests MUST advertise support for gzip responses, and provider clients MUST transparently decode gzip-encoded responses before exposing them to callers.

#### Scenario: Provider returns a gzip-encoded response
- **WHEN** a provider API returns a response with `Content-Encoding: gzip`
- **THEN** the response is decoded and its content is available to the provider client as the original uncompressed content

#### Scenario: Provider returns an uncompressed response
- **WHEN** a provider API returns a response without gzip encoding
- **THEN** the provider client handles it without attempting gzip decompression

### Requirement: Registry Resolution of User-Defined Providers

The provider registry MUST resolve user-defined provider IDs in addition to built-in providers. When `createProvider` is invoked with a provider ID that matches a configured custom provider, it MUST create an OpenAI-compatible client targeting that provider's `baseURL` with its resolved API key and model options. Built-in provider resolution and the existing implicit fallback for unknown IDs with an explicit `baseURL` MUST remain unchanged.

#### Scenario: Custom provider resolves through createProvider

- **WHEN** `createProvider` is called with a provider ID matching a configured custom provider
- **THEN** it returns a client whose `providerId` is the custom ID and whose requests go to the configured `baseURL`

#### Scenario: Built-in provider IDs are unaffected

- **WHEN** `createProvider` is called with a built-in provider ID while custom providers are also configured
- **THEN** the built-in provider definition is used, not a custom entry

#### Scenario: Unknown ID without custom config still errors

- **WHEN** `createProvider` is called with an unknown provider ID, no matching custom provider exists, and no `baseURL` option/env/config is set
- **THEN** it throws the existing "Unknown LLM provider" error listing available providers including configured custom ones

### Requirement: Model Discovery Parity for Custom Providers

The provider infrastructure MUST expose `getModels` for custom providers with the same fallback contract as built-ins: return discovered models when available, otherwise return the default model rather than throwing.

#### Scenario: getModels invoked on custom provider definition

- **WHEN** `getModels` is invoked on a custom provider definition with valid discovery configuration
- **THEN** it returns models discovered via the configured method, or the `defaultModel` fallback on failure

