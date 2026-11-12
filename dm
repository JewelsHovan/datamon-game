#!/bin/sh
# Agent CLI for Compass: Cardinal Clash. Run `./dm help`.
exec node "$(dirname "$0")/scripts/dm.mjs" "$@"
