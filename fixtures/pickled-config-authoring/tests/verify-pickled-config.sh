#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "verify-pickled-config: $*" >&2
  exit 1
}

[[ -f pickled.yml ]] || fail "missing pickled.yml"

# v2 schema gate + rejection of v1 vocabulary.
grep -Eq '^[[:space:]]*schemaVersion:[[:space:]]*2' pickled.yml || fail 'missing "schemaVersion: 2"'
! grep -Eq '^[[:space:]]*tasks:' pickled.yml || fail 'old "tasks" key is not allowed (use questions/builds)'
! grep -Eq '^[[:space:]]*access:' pickled.yml || fail 'old "access" key is not allowed (use contexts)'
! grep -Eq '^[[:space:]]*checks:' pickled.yml || fail 'old "checks" key is not allowed (use facts/misstatements)'
! grep -Eq 'mustMention' pickled.yml || fail 'old mustMention is not allowed (use facts)'

# Sources + contexts: compare memory against injected local llms.
grep -Eq '^[[:space:]]*sources:' pickled.yml || fail 'missing "sources"'
grep -Eq 'path:[[:space:]]*\.\/llms\.txt' pickled.yml || fail 'missing local llms source'
grep -Eq '^[[:space:]]*contexts:' pickled.yml || fail 'missing "contexts"'
grep -Eq 'mode:[[:space:]]*memory' pickled.yml || fail 'missing a memory context'
grep -Eq 'mode:[[:space:]]*inject' pickled.yml || fail 'missing an inject context'

# Question contract: install fact + stale-npm misstatement.
grep -Eq '^[[:space:]]*questions:' pickled.yml || fail 'missing "questions"'
grep -Eq '^[[:space:]]*facts:' pickled.yml || fail 'missing "facts"'
grep -Eq 'bunx brinekit init' pickled.yml || fail 'missing install contract (fact)'
grep -Eq '^[[:space:]]*misstatements:' pickled.yml || fail 'missing "misstatements"'
grep -Eq 'npm install brinekit' pickled.yml || fail 'missing stale-install misstatement'

# Build contract: smoke_build, 2 trials, ./workspace, verifier checks configured.txt.
grep -Eq '^[[:space:]]*builds:' pickled.yml || fail 'missing "builds"'
grep -Eq 'smoke_build' pickled.yml || fail 'missing smoke_build'
grep -Eq '^[[:space:]]*trials:[[:space:]]*2' pickled.yml || fail 'build should run two trials'
grep -Eq '^[[:space:]]*workspace:' pickled.yml || fail 'missing build workspace'
grep -Eq 'path:[[:space:]]*\.\/workspace' pickled.yml || fail 'missing workspace path'
grep -Eq '^[[:space:]]*verifier:' pickled.yml || fail 'missing build verifier'
grep -Eq 'test -f configured\.txt' pickled.yml || fail 'missing configured.txt verifier'

read -r -a pickled_cli <<< "${PICKLED_CLI:-bunx @pickled-dev/cli@latest}"
answer_plan="$("${pickled_cli[@]}" check . --plan --json)"
grep -q '"selectedCells"' <<< "$answer_plan" || fail 'pickled check --plan did not return a plan receipt'
grep -q '"task": "install"' <<< "$answer_plan" || fail 'answer plan does not include the install question'

build_plan="$("${pickled_cli[@]}" build . --plan --json)"
grep -q '"selectedCells"' <<< "$build_plan" || fail 'pickled build --plan did not return a plan receipt'
grep -q '"task": "smoke_build"' <<< "$build_plan" || fail 'build plan does not include smoke_build'

ANSWER_PLAN_JSON="$answer_plan" BUILD_PLAN_JSON="$build_plan" bun - <<'BUN'
const answerReport = JSON.parse(process.env.ANSWER_PLAN_JSON ?? "{}");
const answerCells = answerReport.plan?.cells ?? [];
const buildReport = JSON.parse(process.env.BUILD_PLAN_JSON ?? "{}");
const buildCells = buildReport.plan?.cells ?? [];

// The install question must compare two context paths (memory vs injected llms),
// so it expands to >= 2 cells across distinct contexts.
const installContexts = new Set(
  answerCells
    .filter((cell) => cell.task === "install")
    .map((cell) => cell.context),
);
const buildTrial = buildCells.some(
  (cell) => cell.task === "smoke_build" && cell.trials === 2,
);

if (installContexts.size < 2) {
  console.error(
    "verify-pickled-config: install question must run on at least two contexts (memory vs injected)",
  );
  process.exit(1);
}
if (!buildTrial) {
  console.error("verify-pickled-config: missing smoke_build cell with trials: 2");
  process.exit(1);
}
BUN
