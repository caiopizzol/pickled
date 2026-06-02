#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "verify-pickled-config: $*" >&2
  exit 1
}

[[ -f pickled.yml ]] || fail "missing pickled.yml"

! grep -Eq '^[[:space:]]*questions:' pickled.yml || fail 'old "questions" key is not allowed'
! grep -Eq '^[[:space:]]*ask:' pickled.yml || fail 'old "ask" field is not allowed'

grep -Eq '^[[:space:]]*tasks:' pickled.yml || fail 'missing "tasks"'
grep -Eq '^[[:space:]]*prompt:' pickled.yml || fail 'missing task "prompt"'
grep -Eq '^[[:space:]]*sources:' pickled.yml || fail 'missing "sources"'
grep -Eq '^[[:space:]]*llms:[[:space:]]*\.\/llms\.txt' pickled.yml || fail 'missing local llms source'
grep -Eq '^[[:space:]]*access:' pickled.yml || fail 'missing "access"'
grep -Eq '^[[:space:]]*checks:' pickled.yml || fail 'missing answer checks'
grep -Eq '^[[:space:]]*mustMention:' pickled.yml || fail 'missing mustMention'
grep -Eq 'bunx brinekit init' pickled.yml || fail 'missing install contract'
grep -Eq '^[[:space:]]*mustNotMention:' pickled.yml || fail 'missing mustNotMention'
grep -Eq 'npm install brinekit' pickled.yml || fail 'missing stale-install exclusion'
grep -Eq '^[[:space:]]*kind:[[:space:]]*build' pickled.yml || fail 'missing build task'
grep -Eq '^[[:space:]]*trials:[[:space:]]*2' pickled.yml || fail 'build task should run two trials'
grep -Eq '^[[:space:]]*workspace:' pickled.yml || fail 'missing build workspace'
grep -Eq '^[[:space:]]*path:[[:space:]]*\.\/workspace' pickled.yml || fail 'missing workspace path'
grep -Eq '^[[:space:]]*verify:' pickled.yml || fail 'missing build verify commands'
grep -Eq 'test -f configured\.txt' pickled.yml || fail 'missing configured.txt verifier'

read -r -a pickled_cli <<< "${PICKLED_CLI:-bunx @pickled-dev/cli@latest}"
answer_plan="$("${pickled_cli[@]}" check . --plan --json)"
grep -q '"selectedCells"' <<< "$answer_plan" || fail 'pickled check --plan did not return a plan receipt'
grep -q '"scenario": "install"' <<< "$answer_plan" || fail 'answer plan does not include the install task'

build_plan="$("${pickled_cli[@]}" build . --plan --json)"
grep -q '"selectedCells"' <<< "$build_plan" || fail 'pickled build --plan did not return a plan receipt'
grep -q '"scenario": "smoke_build"' <<< "$build_plan" || fail 'build plan does not include smoke_build'

ANSWER_PLAN_JSON="$answer_plan" BUILD_PLAN_JSON="$build_plan" bun - <<'BUN'
const answerReport = JSON.parse(process.env.ANSWER_PLAN_JSON ?? "{}");
const answerCells = answerReport.plan?.cells ?? [];
const buildReport = JSON.parse(process.env.BUILD_PLAN_JSON ?? "{}");
const buildCells = buildReport.plan?.cells ?? [];

const hasMemory = answerCells.some(
  (cell) =>
    cell.scenario === "install" &&
    cell.source === "none" &&
    cell.toolset === "none",
);
const hasInjectedLlms = answerCells.some(
  (cell) =>
    cell.scenario === "install" &&
    cell.source === "llms" &&
    cell.toolset === "none",
);
const hasBuildTrial = buildCells.some(
  (cell) =>
    cell.scenario === "smoke_build" &&
    cell.source === "llms" &&
    cell.toolset === "none" &&
    cell.trials === 2,
);

if (!hasMemory) {
  console.error(
    'verify-pickled-config: missing source:none/tools:none access cell',
  );
  process.exit(1);
}
if (!hasInjectedLlms) {
  console.error(
    'verify-pickled-config: missing source:llms/tools:none access cell',
  );
  process.exit(1);
}
if (!hasBuildTrial) {
  console.error(
    'verify-pickled-config: missing smoke_build source:llms/tools:none trial cell',
  );
  process.exit(1);
}
BUN
