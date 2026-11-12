#!/usr/bin/env bash
# PreToolUse guard for the game-qa subagent.
# Write and qa-chrome tools with a filePath output: only paths inside $CLAUDE_PROJECT_DIR/.qa/.
# Bash: state-changing git commands and dependency changes are blocked.
# Exit 2 blocks the tool call and shows stderr to the agent.

input=$(cat)
tool=$(jq -r '.tool_name // empty' <<<"$input")
root="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // empty' <<<"$input")}"

case "$tool" in
  Write|mcp__qa-chrome__*)
    path=$(jq -r '.tool_input.file_path // .tool_input.filePath // empty' <<<"$input")
    [ -z "$path" ] && exit 0
    case "$path" in
      /*) ;;
      *) path="$root/$path" ;;
    esac
    case "$path" in
      */../*|*/..)
        echo "game-qa: blocked write to '$path' ('..' not allowed). Write only under $root/.qa/." >&2
        exit 2 ;;
      "$root"/.qa/*) exit 0 ;;
      *)
        echo "game-qa: blocked write to '$path'. QA never changes the game; write evidence and reports only under $root/.qa/." >&2
        exit 2 ;;
    esac
    ;;
  Bash)
    cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
    if grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+(add|commit|checkout|restore|reset|stash|clean|push|pull|rebase|merge|switch|rm|mv|apply|am|cherry-pick|revert|tag)([^[:alnum:]_-]|$)' <<<"$cmd"; then
      echo "game-qa: blocked a state-changing git command. QA is read-only on the repo." >&2
      exit 2
    fi
    if grep -Eq '(^|[^[:alnum:]_-])(npm|pnpm|yarn|bun)[[:space:]]+(install|i|add|remove|uninstall|rm|update|up)([[:space:]]+-[^[:space:]]+)*[[:space:]]+[^-[:space:]>|&;]' <<<"$cmd"; then
      echo "game-qa: blocked a dependency change. Plain 'npm install' (no package names) is allowed; report missing tooling as a testability finding." >&2
      exit 2
    fi
    exit 0
    ;;
esac
exit 0
