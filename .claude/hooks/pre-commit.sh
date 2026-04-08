#!/usr/bin/env bash

deny() {
  printf '%s' "{\"hookSpecificOutput\": {\"hookEventName\": \"PreToolUse\", \"permissionDecision\": \"deny\", \"permissionDecisionReason\": $(jq -Rsa . <<< "$1")}}"
  exit 0
}

bun run lint:fix &>/dev/null || deny "Lint errors remain after auto-fix. Run 'bun run lint:fix', fix any remaining issues, then retry the commit."
bun typecheck &>/dev/null || deny "Type errors found. Run 'bun typecheck' to see them, fix them, then retry the commit."
bun test &>/dev/null || deny "Tests failed. Fix them then retry the commit."

coverage_out=$(bun test --coverage 2>&1)
pct=$(echo "$coverage_out" | awk '/All files/ {gsub(/%/,"",$4); print int($4)}')
[ -n "$pct" ] && [ "$pct" -lt 85 ] && deny "Line coverage ${pct}% is below the 85% threshold. Add tests or update coveragePathIgnorePatterns in bunfig.toml if the drop is from untestable code."

printf '%s' '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'
