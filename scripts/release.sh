#!/usr/bin/env sh

set -eu

abort() {
  printf 'Release aborted: %s\n' "$1" >&2
  exit 1
}

bump_type="${1:-}"
case "$bump_type" in
  major|minor|patch) ;;
  *)
    printf 'Usage: bun run release -- <major|minor|patch>\n' >&2
    exit 1
    ;;
esac

command -v git >/dev/null 2>&1 || abort 'git is required'
command -v gh >/dev/null 2>&1 || abort 'GitHub CLI (gh) is required'

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || abort 'this directory is not a git repository'

if ! git diff --cached --quiet; then
  printf 'Release aborted: staged changes detected. Commit or unstage them first.\n' >&2
  printf 'Staged files:\n' >&2
  git diff --cached --name-status >&2 || true
  exit 1
fi

bun run bump:version -- "$bump_type"
bun run verify

git add package.json
version="$(bun -e "console.log((await Bun.file('package.json').json()).version)")"
tag="v${version}"

git commit -m "chore: bump version to ${version}"
git tag "$tag"
git push origin HEAD "$tag"
gh release create "$tag" --generate-notes --verify-tag

printf 'Published mini-agent %s\n' "$tag"
