#!/usr/bin/env bash

set -euo pipefail

readonly repository="Mitriyweb/mini-agent"
readonly install_dir="${MINI_AGENT_INSTALL_DIR:-${HOME}/.local/bin}"

if [[ "$(uname -s)" == "Darwin" ]]; then
  platform="darwin"
elif [[ "$(uname -s)" == "Linux" ]]; then
  platform="linux"
else
  printf 'Unsupported operating system: %s\n' "$(uname -s)" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64|aarch64) architecture="arm64" ;;
  x86_64|amd64) architecture="x64" ;;
  *)
    printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

version="${MINI_AGENT_VERSION:-latest}"
if [[ "$version" == "latest" ]]; then
  asset_url="https://github.com/${repository}/releases/latest/download/mini-agent-${platform}-${architecture}"
else
  asset_url="https://github.com/${repository}/releases/download/${version}/mini-agent-${platform}-${architecture}"
fi

tmp_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

printf 'Downloading mini-agent (%s, %s, %s)...\n' "$version" "$platform" "$architecture"
curl --fail --silent --show-error --location "$asset_url" --output "$tmp_file"
mkdir -p "$install_dir"
install -m 0755 "$tmp_file" "${install_dir}/mini-agent"

printf 'Installed mini-agent to %s\n' "${install_dir}/mini-agent"
if [[ ":${PATH}:" != *":${install_dir}:"* ]]; then
  printf 'Add %s to PATH to run mini-agent directly.\n' "$install_dir"
fi