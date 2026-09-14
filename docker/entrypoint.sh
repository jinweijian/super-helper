#!/bin/sh
set -eu
if [ -n "${ANTHROPIC_API_KEY_FILE:-}" ] && [ -f "$ANTHROPIC_API_KEY_FILE" ]; then
  ANTHROPIC_API_KEY="$(cat "$ANTHROPIC_API_KEY_FILE")"
  export ANTHROPIC_API_KEY
fi
exec "$@"
