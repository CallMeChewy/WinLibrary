#!/usr/bin/env bash
set -euo pipefail

# Resolve repository root relative to this script
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORKDIR=${1:-$SCRIPT_DIR}

# Shift positional arguments when explicit working directory supplied
if [[ $# -gt 0 ]]; then
  shift
fi

exec codex \
  --sandbox danger-full-access \
  -a on-request \
  -C "$WORKDIR" \
  "$@"
