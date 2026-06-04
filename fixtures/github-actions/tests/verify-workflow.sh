#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "verify-workflow: $*" >&2
  exit 1
}

workflow=".github/workflows/pickled.yml"

[[ -f "$workflow" ]] || fail "missing .github/workflows/pickled.yml"
[[ -f pickled.yml ]] || fail "missing pickled.yml"

! grep -Eq 'pull_request_target' "$workflow" || fail "pull_request_target is not allowed"

grep -Eq 'pull_request:' "$workflow" || fail "missing pull_request trigger"
grep -Eq 'workflow_dispatch:' "$workflow" || fail "missing workflow_dispatch trigger"
grep -Eq 'schedule:' "$workflow" || fail "missing schedule trigger"

grep -Eq 'bunx[[:space:]]+@pickled-dev/cli[[:space:]]+test[[:space:]]+\.' "$workflow" || fail "missing pickled test"
grep -Eq 'bunx[[:space:]]+@pickled-dev/cli[[:space:]]+check[[:space:]]+\.[[:space:]]+--plan' "$workflow" || fail "missing pickled check --plan"
grep -Eq 'bunx[[:space:]]+@pickled-dev/cli[[:space:]]+build[[:space:]]+\.[[:space:]]+--plan' "$workflow" || fail "missing pickled build --plan"

grep -Eq 'bunx[[:space:]]+@pickled-dev/cli[[:space:]]+check[[:space:]]+\.[[:space:]].*--max-cells' "$workflow" || fail "missing capped real check"
grep -Eq 'bunx[[:space:]]+@pickled-dev/cli[[:space:]]+build[[:space:]]+\.[[:space:]].*--max-cells' "$workflow" || fail "missing capped real build"

grep -Eq 'ANTHROPIC_API_KEY' "$workflow" || fail "missing ANTHROPIC_API_KEY"
grep -Eq 'secrets\.ANTHROPIC_API_KEY' "$workflow" || fail "ANTHROPIC_API_KEY must come from GitHub secrets"

grep -Eq "github\.event_name[[:space:]]*==[[:space:]]*'workflow_dispatch'" "$workflow" || fail "real-agent job must allow workflow_dispatch"
grep -Eq "github\.event_name[[:space:]]*==[[:space:]]*'schedule'" "$workflow" || fail "real-agent job must allow schedule"
