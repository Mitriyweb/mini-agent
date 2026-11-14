#!/usr/bin/env sh

set -eu

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

printf '%s\n' 'Review preflight: cheap automated checks before any token-heavy review.'

printf '\n%s\n' '## Git status --short'
git status --short

printf '\n%s\n' '## git diff HEAD --name-only'
git diff HEAD --name-only

printf '\n%s\n' '## git diff HEAD --stat'
git diff HEAD --stat

printf '\n%s\n' '## git diff HEAD --check'
git diff HEAD --check

printf '\n%s\n' '## bun x tsc --noEmit'
bun x tsc --noEmit

printf '\n%s\n' '## Biome lint on changed files'
lint_changed_files() {
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    [ -f "$file" ] || continue
    bun x biome lint --no-errors-on-unmatched "$file"
  done
}

git diff --name-only HEAD | lint_changed_files
git ls-files --others --exclude-standard | lint_changed_files

printf '\n%s\n' 'Review preflight passed. No token-heavy review needed until this step is green.'
