# Coding Standards

These are the default coding standards for every task. Apply them unless the project or user explicitly requires a different convention.

## Core Principles

- Prefer the simplest solution that fully solves the task.
- Keep code readable and self-documenting; use descriptive names.
- Avoid speculative abstractions and premature optimization.
- Remove duplication when a small, clear reusable helper improves consistency.
- Keep changes focused on the requested behavior and preserve existing public APIs.

## Naming and Structure

- Use descriptive names that communicate purpose.
- Name functions with verb-noun patterns such as `loadConfig`, `resolvePath`, or `isValidInput`.
- Keep functions small enough to understand locally.
- Prefer early returns for invalid input and exceptional branches.
- Match the repository's existing formatting, module system, and file organization.

## Immutability and State

- Prefer `const` and immutable transformations.
- Do not mutate objects or arrays owned by callers unless the API explicitly requires it.
- Use object and array spreads when producing updated values.
- Keep shared state localized and make side effects explicit.

## TypeScript and JavaScript

- Prefer precise types over `any`; use `unknown` at untrusted boundaries and narrow it safely.
- Handle nullable and optional values deliberately.
- Use `node:` prefixes for Node.js built-ins.
- Preserve strict type checking and do not silence errors without a documented reason.
- Use `async`/`await` consistently and handle rejected promises.
- Run independent asynchronous operations in parallel when there is no ordering dependency.

## Errors and Boundaries

- Validate inputs at module and tool boundaries.
- Check filesystem, process, and network errors rather than assuming success.
- Include useful context in errors without exposing secrets.
- Do not swallow errors silently; recover only when the fallback is intentional.
- Preserve workspace and trust-root containment for all file and command operations.

## Review Checklist

Before finishing a task:

- Confirm the change is minimal and directly addresses the request.
- Check names, types, error paths, and side effects.
- Check that tests cover the changed behavior when practical.
- Run the repository's unified verification command when available.
