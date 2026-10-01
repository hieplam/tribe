#!/usr/bin/env bash
# test-doctor-model.sh — card runner-model-support (G2): `doctor.sh --model <id>` proves the
# runner's own SDK can run each model, and refuses one it cannot with the model, the API's own
# reason and the fix. Hermetic: the probe's session is the executor double printing REAL captured
# result lines (runner/fixtures/executor/), so no model is ever called. doctor.sh is COPIED into a
# throwaway scripts/ tree (it resolves its own directory with `pwd -P`); `runner` there is a
# symlink to the real runner, so the probe runs the real `run.ts probe-model`.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$HERE/.." && pwd)"
FIXTURES="$SCRIPTS/runner/fixtures/executor"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
has()   { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (want substring: $3, got: $2)"; fi; }
hasnt() { if [[ "$2" != *"$3"* ]]; then ok "$1"; else bad "$1 (unwanted substring: $3)"; fi; }

# A provisioned scripts/ tree: doctor.sh, the real runner, a built-viewer stub.
mkdir -p "$TMP/scripts/viewer/dist"
cp "$SCRIPTS/doctor.sh" "$TMP/scripts/doctor.sh"
ln -s "$SCRIPTS/runner" "$TMP/scripts/runner"
printf '<!doctype html>\n' > "$TMP/scripts/viewer/dist/index.html"

# Three probe doubles: a clean answer, the real 2026-10-01 refusal, the real unknown-model 404.
printf '#!/usr/bin/env bash\necho OK\n' > "$TMP/ok.sh"
printf '#!/usr/bin/env bash\ncat %q\n' "$FIXTURES/result-claude-code-version-too-old.json" > "$TMP/too-old.sh"
printf '#!/usr/bin/env bash\ncat %q\n' "$FIXTURES/result-model-not-found-404.json" > "$TMP/not-found.sh"
chmod +x "$TMP/ok.sh" "$TMP/too-old.sh" "$TMP/not-found.sh"

doctor() { # doctor DOUBLE ARGS... -> sets OUT and RC
  set +e
  OUT="$(cd "$TMP" && TRIBE_RUNNER_SESSION_DOUBLE="$1" bash "$TMP/scripts/doctor.sh" "${@:2}" 2>&1)"; RC=$?
  set -e
}

doctor "$TMP/ok.sh"
check "no --model: exit 0, as before" "$RC" "0"
hasnt "no --model: no model line" "$OUT" "model "

doctor "$TMP/ok.sh" --model claude-opus-5-5
check "a model the SDK runs: exit 0" "$RC" "0"
has "a model the SDK runs: an ok line naming it" "$OUT" "ok    model claude-opus-5-5 runs on the runner's SDK"

doctor "$TMP/too-old.sh" --model claude-opus-5-5
check "the 2026-10-01 refusal: exit 1" "$RC" "1"
has "the refusal: a MISSING line naming the model" "$OUT" "MISSING model claude-opus-5-5 cannot run on the runner's SDK"
has "the refusal: the API's own reason" "$OUT" "version 2.1.280 or newer is required"
has "the refusal: the code" "$OUT" "api_error_code claude_code_version_too_old"
has "the refusal: the fix names the SDK bump" "$OUT" "-> bump @anthropic-ai/claude-agent-sdk"

doctor "$TMP/not-found.sh" --model claude-nonexistent-9
check "an unknown model: exit 1" "$RC" "1"
has "an unknown model: HTTP 404 and the API's words" "$OUT" "It may not exist or you may not have access to it"
has "an unknown model: the fix says to check the id" "$OUT" '-> check the model id "claude-nonexistent-9"'

doctor "$TMP/too-old.sh" --model a --model b
check "two models, both refused: exit 1" "$RC" "1"
check "two models: one MISSING line each" "$(printf '%s\n' "$OUT" | grep -c '^  MISSING model ')" "2"
has "two models: the summary counts both" "$OUT" "2 prerequisite(s) missing"

doctor "$TMP/ok.sh" --model
check "--model with no id: usage error, exit 2" "$RC" "2"
has "--model with no id: says so" "$OUT" "--model needs a model id"
doctor "$TMP/ok.sh" --model --model
check "--model never swallows the next flag: exit 2" "$RC" "2"
doctor "$TMP/ok.sh" --fast
check "an unknown argument: exit 2" "$RC" "2"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" == "0" ]]; then echo "DOCTOR-MODEL=PASS"; else echo "DOCTOR-MODEL=FAIL"; exit 1; fi
