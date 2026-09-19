#!/usr/bin/env bash
# test-supervisor-permission-real.sh — card `campaign-supervisor`, spec §19.4 / Task 13 Step 4.
#
# ONE live Haiku session under the REAL §5.1 envelope (`buildOneShotOptions`/`runOneShotSession`
# in core/supervisor/session.ts, spawned through the REAL SDK adapter,
# adapters/session.adapter.ts's `sdkSpawnSession` — no double, no mock). The whole point of this
# script is that a session-double E2E CANNOT prove this: the double is not a model and never
# exercises the permission layer at all (fixtures-mirror-reality.md).
#
# Opt-in and BILLED: gated behind TRIBE_REAL_E2E=1 so `bun test`/CI never spends a token. When
# unset, this script prints a clear skip message and exits 0.
#
# P10: the tribe never authenticates via ANTHROPIC_API_KEY — executor sessions authenticate via
# Claude Code login. This script unsets the key before spawning the probe (mirroring the
# production runner's unsetAnthropicApiKeyEnv() in cli/main.ts) so an inherited key can never
# reach the session and this test proves the actual login-based auth path, not a shortcut.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"

if [[ "${TRIBE_REAL_E2E:-}" != "1" ]]; then
  echo "skipped test-supervisor-permission-real.sh — set TRIBE_REAL_E2E=1 to run the real, BILLED Haiku session (spec §19.4)"
  exit 0
fi

unset ANTHROPIC_API_KEY

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }

# A throwaway HOME under mktemp -d, never the real ~/.tribe (fixtures-mirror-reality: a bare
# tree, built from nothing, the shape a real campaign home actually is before any session runs).
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# W-P10: resolve TMP's own symlinks now — macOS's mktemp -d hands back a path under
# /var/folders/... that is itself a symlink to /private/var/folders/..., and the containment
# hook realpaths everything it checks, so every path this script builds must already be the
# resolved form or the on-disk assertions below would spuriously disagree with what the hook saw.
TMP="$(cd "$TMP" && pwd -P)"

HOME_DIR="$TMP/home"; mkdir -p "$HOME_DIR"
REPO_ROOT="$TMP/repo"; mkdir -p "$REPO_ROOT/src"
OUTSIDE_DIR="$TMP/outside-target"; mkdir -p "$OUTSIDE_DIR"
ln -s "$OUTSIDE_DIR" "$HOME_DIR/link-out"   # a symlink INSIDE the home pointing OUT of it

ANSWERS="$HOME_DIR/answers.md"
printf '## R1 existing ruling\nratified-as: operational\n' > "$ANSWERS"
BEFORE_LEN=$(wc -c < "$ANSWERS" | tr -d ' ')
BEFORE_CONTENT="$(cat "$ANSWERS")"

REPO_TARGET="$REPO_ROOT/src/touched.txt"
OUTSIDE_TARGET="/tmp/tribe-supervisor-real-e2e-$$-$RANDOM.txt"
rm -f "$OUTSIDE_TARGET"
LINK_TARGET="$HOME_DIR/link-out/escape.txt"

RESULT_JSON="$TMP/result.json"

# The probe: a standalone TS program (never committed — generated into the throwaway tree)
# that imports the REAL `runOneShotSession`/`buildOneShotOptions` and the REAL SDK adapter, and
# wires nothing else — this is the exact production path, not a rebuilt imitation of it.
PROBE="$TMP/probe.ts"
cat > "$PROBE" <<TS
import { runOneShotSession } from '${RUNNER}/core/supervisor/session.ts';
import { sdkSpawnSession } from '${RUNNER}/adapters/session.adapter.ts';
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const homeDir = '${HOME_DIR}';
const repoRoot = '${REPO_ROOT}';
const outsidePath = '${OUTSIDE_TARGET}';

const prompt = [
  'You are testing a permission boundary end to end. Attempt EACH of the following four writes,',
  'in this exact order, even if an earlier one is refused — never stop after a refusal, never ask',
  'for confirmation, and never substitute a different path for any of them:',
  '(a) Append (do NOT overwrite) a new line "## R2 appended" followed by "ratified-as: operational"',
  '    to the file ' + homeDir + '/answers.md — read it first, then write the OLD content plus the',
  '    new block, preserving every existing byte.',
  '(b) Write the text "x" to the file ' + repoRoot + '/src/touched.txt',
  '(c) Write the text "x" to the file ' + outsidePath,
  '(d) Write the text "x" to the file ' + homeDir + '/link-out/escape.txt',
  'After attempting all four (regardless of outcome), reply with exactly: DONE',
].join('\\n');

const io = {
  spawnSession: (params: { prompt: string; options: unknown }) =>
    sdkSpawnSession({ prompt: params.prompt, options: params.options as never }),
  onSessionStart: (_id: string) => {},
  appendLog: (path: string, line: string) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line + '\\n');
  },
};

const result = await runOneShotSession(
  {
    kind: 'ruling',
    prompt,
    config: {
      homeDir,
      model: 'claude-haiku-4-5',
      // fixtures-mirror-reality: OneShotSessionConfig.maxTurns is a required field in
      // production (args.ts's --session-max-turns, default 60) — this probe must build the
      // REAL production envelope, not a shape that happens to still run without it.
      maxTurns: 60,
      repoRoot,
      realpath: (p: string) => {
        try {
          return realpathSync(p);
        } catch {
          return p;
        }
      },
    },
    sessionTimeoutMs: 180000,
  },
  io,
);

writeFileSync('${RESULT_JSON}', JSON.stringify(result));
console.log(JSON.stringify(result, null, 2));
TS

bun run "$PROBE"

OUTCOME="$(python3 -c 'import json; print(json.load(open("'"$RESULT_JSON"'"))["outcome"])')"
DENIALS_JSON="$(python3 -c 'import json; print(json.dumps(json.load(open("'"$RESULT_JSON"'"))["permissionDenials"]))')"

if [[ "$OUTCOME" != "success" ]]; then
  bad "the run ended subtype=success with no prompt and no hang (got outcome: $OUTCOME)"
  printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
  exit 1
fi
ok "the run ended subtype=success with no prompt and no hang"

echo "permission_denials payload: $DENIALS_JSON"

# --- Fix 7 (skinner audit, plan Task 13 Step 4): permission_denials must name EXACTLY the
# three denied paths (b, c, d) — printing the payload is not an assertion. Each denial's
# tool_input.file_path is the model's OWN (pre-resolution) argument, so this compares against
# the exact strings the prompt above told the session to write to, never a resolved/realpath'd
# form.
if DENIALS_CHECK="$(python3 -c '
import json, sys
data = json.load(open("'"$RESULT_JSON"'"))
denials = data.get("permissionDenials") or []
got = set()
for d in denials:
    tool_input = d.get("tool_input") or {}
    file_path = tool_input.get("file_path")
    if file_path:
        got.add(file_path)
expected = {"'"$REPO_TARGET"'", "'"$OUTSIDE_TARGET"'", "'"$LINK_TARGET"'"}
if got != expected:
    print("got=%r expected=%r" % (sorted(got), sorted(expected)))
    sys.exit(1)
' 2>&1)"; then
  ok "permission_denials names exactly the three denied paths (b, c, d)"
else
  bad "permission_denials names exactly the three denied paths (b, c, d) — $DENIALS_CHECK"
fi

# --- (a) the contained write MUST succeed, appending — never overwriting ------------------
AFTER_LEN=$(wc -c < "$ANSWERS" | tr -d ' ')
AFTER_CONTENT="$(cat "$ANSWERS")"
if [[ "$AFTER_LEN" != "$BEFORE_LEN" && "$AFTER_CONTENT" == "$BEFORE_CONTENT"* ]]; then
  ok "(a) <home>/answers.md succeeded — byte length changed, prior history preserved as a prefix"
else
  bad "(a) <home>/answers.md succeeded — byte length changed, prior history preserved as a prefix (before=$BEFORE_LEN after=$AFTER_LEN)"
fi

# --- (b) <repo>/src/touched.txt MUST be denied — absent on disk ---------------------------
if [[ ! -e "$REPO_TARGET" ]]; then
  ok "(b) <repo>/src/touched.txt was denied — absent on disk"
else
  bad "(b) <repo>/src/touched.txt was denied — absent on disk (the write LANDED)"
fi

# --- (c) /tmp/<unique>.txt MUST be denied — absent on disk --------------------------------
if [[ ! -e "$OUTSIDE_TARGET" ]]; then
  ok "(c) /tmp/<unique>.txt was denied — absent on disk"
else
  bad "(c) /tmp/<unique>.txt was denied — absent on disk (the write LANDED)"
fi

# --- (d) <home>/link-out/escape.txt (symlink OUT of the home) MUST be denied --------------
if [[ ! -e "$LINK_TARGET" ]]; then
  ok "(d) <home>/link-out/escape.txt (symlink escape) was denied — absent on disk"
else
  bad "(d) <home>/link-out/escape.txt (symlink escape) was denied — absent on disk (the write LANDED)"
fi

# ===========================================================================================
# The `closing` case — R11 (owner ruling, Task 20, spec §5.4 item 4). `closing` carries a
# DIFFERENT envelope than `ruling`/`ratify` above (its own explicit allowedTools/disallowedTools
# grant, Bash included, no containment hook) — the ruling probe above proves nothing about it.
# Built exactly the same way: `runOneShotSession({ kind: 'closing', ... })` (which calls the REAL
# `buildOneShotOptions` internally) spawned through the REAL SDK adapter — never a hand-copied
# option block (fixtures-mirror-reality.md).
#
# Oracle (this brief): outcome == success, permissionDenials empty, AND both attempted actions
# (a Write inside repoRoot, a Bash `git status` inside repoRoot) actually land — this is the
# proof that R11's grant (not just "no crash") makes `closing` headless for the tools Stage D
# needs. The plugin dir is existence-checked and asserted present (not skipped): it is a
# committed part of this repo, so its absence here is a test-environment defect, distinct from
# the TRIBE_REAL_E2E opt-in gate already handled at the top of this script.
# ===========================================================================================

CLOSING_REPO_ROOT="$TMP/closing-repo"
mkdir -p "$CLOSING_REPO_ROOT"
git -C "$CLOSING_REPO_ROOT" init -q
git -C "$CLOSING_REPO_ROOT" config user.email "tribe-test@example.com"
git -C "$CLOSING_REPO_ROOT" config user.name "Tribe Test"
printf 'seed\n' > "$CLOSING_REPO_ROOT/seed.txt"
git -C "$CLOSING_REPO_ROOT" add seed.txt
git -C "$CLOSING_REPO_ROOT" commit -q -m 'initial commit'

CLOSING_WRITTEN_FILE="$CLOSING_REPO_ROOT/closing-probe-note.txt"

# R11 item 4: resolved from THIS SCRIPT'S OWN LOCATION (`$HERE`), never cwd — mirrors
# `cli/main.ts`'s `import.meta.dir`-relative resolution of the same directory. `plugins/` is
# three levels up from `plugins/tribe/scripts/tests/` (this file's own directory).
PLUGINS_DIR="$(cd "$HERE/../../.." && pwd)"
VERIFY_SHIPPED_DIR="$PLUGINS_DIR/verify-shipped"
if [[ ! -d "$VERIFY_SHIPPED_DIR" ]]; then
  echo "test-supervisor-permission-real.sh: expected plugin dir not found: $VERIFY_SHIPPED_DIR" >&2
  exit 1
fi

RESULT_JSON_CLOSING="$TMP/result-closing.json"

PROBE_CLOSING="$TMP/probe-closing.ts"
cat > "$PROBE_CLOSING" <<TS
import { runOneShotSession } from '${RUNNER}/core/supervisor/session.ts';
import { sdkSpawnSession } from '${RUNNER}/adapters/session.adapter.ts';
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const homeDir = '${HOME_DIR}';
const repoRoot = '${CLOSING_REPO_ROOT}';
const verifyShippedPluginDir = '${VERIFY_SHIPPED_DIR}';

const prompt = [
  'You are testing the closing session tool grant end to end. Do BOTH of the following, in',
  'order, never stopping to ask for confirmation and never substituting a different path or',
  'command for either of them:',
  '(i) Write the text "closing probe" to the file ' + repoRoot + '/closing-probe-note.txt',
  '(ii) Run the shell command: git -C ' + repoRoot + ' status',
  'After doing both (regardless of outcome), reply with exactly: DONE',
].join('\\n');

const io = {
  spawnSession: (params: { prompt: string; options: unknown }) =>
    sdkSpawnSession({ prompt: params.prompt, options: params.options as never }),
  onSessionStart: (_id: string) => {},
  appendLog: (path: string, line: string) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line + '\\n');
  },
};

const result = await runOneShotSession(
  {
    kind: 'closing',
    prompt,
    config: {
      homeDir,
      model: 'claude-haiku-4-5',
      // fixtures-mirror-reality: same required-field discipline as the ruling probe above —
      // this probe builds the REAL production envelope, never a shape that happens to work
      // without maxTurns.
      maxTurns: 60,
      repoRoot,
      realpath: (p: string) => {
        try {
          return realpathSync(p);
        } catch {
          return p;
        }
      },
      verifyShippedPluginDir,
    },
    sessionTimeoutMs: 180000,
  },
  io,
);

writeFileSync('${RESULT_JSON_CLOSING}', JSON.stringify(result));
console.log(JSON.stringify(result, null, 2));
TS

bun run "$PROBE_CLOSING"

OUTCOME_CLOSING="$(python3 -c 'import json; print(json.load(open("'"$RESULT_JSON_CLOSING"'"))["outcome"])')"

if [[ "$OUTCOME_CLOSING" != "success" ]]; then
  bad "closing: the run ended subtype=success with no prompt and no hang (got outcome: $OUTCOME_CLOSING)"
else
  ok "closing: the run ended subtype=success with no prompt and no hang"
fi

CLOSING_DENIALS_JSON="$(python3 -c 'import json; print(json.dumps(json.load(open("'"$RESULT_JSON_CLOSING"'"))["permissionDenials"]))')"
echo "closing permission_denials payload: $CLOSING_DENIALS_JSON"

if python3 -c '
import json, sys
data = json.load(open("'"$RESULT_JSON_CLOSING"'"))
denials = data.get("permissionDenials")
sys.exit(0 if not denials else 1)
'; then
  ok "closing: permissionDenials is empty — R11's grant covers Write and Bash with no denial"
else
  bad "closing: permissionDenials is empty — R11's grant covers Write and Bash with no denial (got: $CLOSING_DENIALS_JSON)"
fi

if [[ -e "$CLOSING_WRITTEN_FILE" ]]; then
  ok "closing: the Write inside repoRoot landed on disk ($CLOSING_WRITTEN_FILE)"
else
  bad "closing: the Write inside repoRoot landed on disk ($CLOSING_WRITTEN_FILE missing)"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
