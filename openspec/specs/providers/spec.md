# OpenSpec: Providers Domain Specification

## Overview
The `providers` domain manages LLM completion endpoints, ProviderRegistry, and client generation (`router`, `openai`, `anthropic`, `google`).

## Requirements

### Requirement: Dynamic Model Discovery
Providers MUST support model discovery via `getModels()` or return default fallback models when discovery fails.

#### Scenario: Router Model Listing
- **Given** model-router endpoint
- **When** `getModels()` is invoked
- **Then** list of available models is returned.
