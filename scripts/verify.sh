#!/usr/bin/env sh

set -eu

printf '%s\n' 'Running Biome...'
bunx biome lint --changed --error-on-warnings --no-errors-on-unmatched .
printf '%s\n' 'Running typecheck...'
bun run check
printf '%s\n' 'Running tests...'
bun run test
printf '%s\n' 'Running build...'
bun run build
printf '%s\n' 'All checks passed.'