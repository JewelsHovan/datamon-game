#!/bin/sh
# Agent CLI for Datamon: Merge Conflict. Run `./dm help`.
exec node "$(dirname "$0")/scripts/dm.mjs" "$@"
