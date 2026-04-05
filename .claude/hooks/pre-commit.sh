#!/usr/bin/env bash

deny() {
  printf '%s' "{\"hookSpecificOutput\": {\"hookEventName\": \"PreToolUse\", \"permissionDecision\": \"deny\", \"permissionDecisionReason\": $(jq -Rsa . <<< "$1")}}"
  exit 0
}

bun run lint:fix &>/dev/null || deny "Lint errors remain after auto-fix. Run 'bun run lint:fix', fix any remaining issues, then retry the commit."
bun typecheck &>/dev/null || deny "Type errors found. Run 'bun typecheck' to see them, fix them, then retry the commit."
bun test &>/dev/null || deny "Tests failed. Fix them then retry the commit."

printf '%s' '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'
