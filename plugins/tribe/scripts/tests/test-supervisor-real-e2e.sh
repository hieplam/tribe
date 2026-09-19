#!/usr/bin/env bash
# test-supervisor-real-e2e.sh — card `campaign-supervisor`, Task 20 (plan
# docs/superpowers/plans/2026-09-18-campaign-supervisor.md, Task 20). The ONE real, BILLED,
# unattended run: G1 ("no babysitter" — a campaign with >= 1 Shaman-answerable escalation runs
# from supervisor start to the final owner report with no interactive session open), G5 (the
# ledger, mechanically), and G0 (the ratchet measures and commits real per-kind ceilings).
#
# Opt-in and BILLED: gated behind TRIBE_REAL_E2E=1 so `bun test`/CI never spends a token. When
# unset, this script prints a clear skip message and exits 0 (same convention as
# test-supervisor-permission-real.sh).
#
# P10: auth is via Claude Code LOGIN, never ANTHROPIC_API_KEY (Task 13's fix, commit 3f5ca84) —
# this script unsets the key before spawning `supervise`.
#
# W-P16 (this task's own finding): unlike test-supervisor-e2e.sh (the session-DOUBLE e2e), this
# script does NOT export a throwaway $HOME. The Claude Agent SDK's login state lives under the
# real $HOME (`~/.claude/...`), not only the OS keychain — overriding $HOME here made a real
# session reply "Not logged in · Please run /login" (verified empirically while building this
# script). Isolation from the real campaign's own home is achieved a different way: `--repo`
# names a THROWAWAY git repo under `mktemp -d`, so `tribe-home.sh` (which is keyed off the
# REPO's own path, not a hardcoded constant) derives a per-run tribe home under
# `~/.tribe/<throwaway-repo-key>/` — a directory that has never existed before this run and is
# always distinct from the real `~/.tribe/-Users-hip-repo-tribe/` the actual campaign-supervisor
# campaign uses. This script deletes its derived tribe home in its EXIT trap.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
REPO_ROOT="$(cd "$HERE/../../../.." && pwd)"

if [[ "${TRIBE_REAL_E2E:-}" != "1" ]]; then
  echo "skipped test-supervisor-real-e2e.sh — set TRIBE_REAL_E2E=1 to run the real, BILLED Haiku end-to-end campaign (card campaign-supervisor, Task 20)"
  exit 0
fi

echo "test-supervisor-real-e2e.sh: TRIBE_REAL_E2E=1 — this run spends real tokens on Haiku."
echo "Estimated cost: 2-3 one-shot Haiku sessions (ruling + closing, ratify only if the ruling"
echo "leaves an unratified block) at roughly \$0.01-\$0.10 each — under \$0.50 total, matching the"
echo "single-turn Haiku smoke measured while building this script (\$0.0265)."

unset ANTHROPIC_API_KEY

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check()    { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi }
absent()   { if [[ ! -e "$2" ]]; then ok "$1"; else bad "$1 (unexpectedly present: $2)"; fi }

TMP="$(mktemp -d)"
# W-P10 (test-supervisor-e2e.sh's own precedent): resolve TMP's own symlinks now — macOS's
# `mktemp -d` hands back a path under `/var/folders/...` that is itself a symlink to
# `/private/var/folders/...`, and the supervisor's own containment gate realpaths `--home`
# before comparing it to the tribe root.
TMP="$(cd "$TMP" && pwd -P)"

# A throwaway target repo — real `git`, never a network remote.
REPO="$TMP/repo"; git init -q -b master "$REPO"
git -C "$REPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init

# The per-repo tribe home this throwaway repo derives — NEVER the real tribe repo's home (see
# the module doc comment above). Deleted in the EXIT trap below.
TRIBE_HOME="$(bash "$RUNNER/../tribe-home.sh" "$REPO")"
trap 'rm -rf "$TMP" "$TRIBE_HOME"' EXIT

SLUG="e2e-real-$$-$RANDOM"
HOME_DIR="$TRIBE_HOME/campaigns/$SLUG"

# Assembled from NOTHING (fixtures-mirror-reality rule 2): card c1 pre-marked `shipped` (so the
# one real watchdog/runner re-verification pass this run triggers after the ruling lands
# finishes in well under a second — no `gh`, no session, no network — precisely mirroring
# test-supervisor-e2e.sh's own `new_campaign` precedent), a pre-seeded terminal
# `escalations_pending` so the tick machinery goes straight to the real ruling session instead
# of first spawning a real watchdog run to discover it, and ONE escalation scoped as a pure
# campaign-mechanics sequencing question — answerable within Shaman authority, never owner-only.
mkdir -p "$HOME_DIR/escalations" "$HOME_DIR/watchdog"
cat > "$HOME_DIR/campaign-state.json" <<JSON
{
  "v": 1,
  "campaign": "$SLUG",
  "mergePolicy": "regular-merge-only",
  "sequence": ["c1"],
  "schemaLockPaths": [],
  "docsOnlyPaths": [],
  "ownerOnlyEscalations": [],
  "cards": {
    "c1": {
      "status": "shipped",
      "spec": "docs/never-authored-spec.md",
      "plan": "docs/never-authored-plan.md",
      "branch": null,
      "baseSha": null,
      "pr": 1,
      "mergeSha": "deadbeef",
      "sessionId": null,
      "updatedAt": null
    }
  }
}
JSON
: > "$HOME_DIR/answers.md"
cat > "$HOME_DIR/escalations/c1.md" <<'MD'
**Reason:** generic-ruling-needed

## Context
This is a toy end-to-end proof campaign (card `campaign-supervisor`, Task 20's real E2E run).
Card c1 is already shipped; this escalation exists only to exercise the real ruling pathway end
to end. The question: should this toy campaign's own sequencing use plan A (ship first,
escalate after) or plan B (escalate first, ship after)? This is a pure campaign-mechanics
sequencing question scoped to this one throwaway campaign — it names no data-shape change, no
product promise, and no new permission, so it is squarely within Shaman authority and should be
ruled `operational`, never parked. Rule plan B.

## Exact required format for your ruling block — copy this literally, do not paraphrase it

Append to `answers.md` (do not add any other heading, title, or field — the parser below reads
ONLY this shape):

```
## R1

ratified-as: operational

Plan B: escalate first, ship after.
```

The `ratified-as:` line is READ BY A REGEX, not by a human: it must be a line starting with the
exact lowercase, hyphenated token `ratified-as:` (never `Ratified as:`, never `**Ratified-As:**`,
never any other spelling or bolding) immediately followed by one of the frozen vocabulary words.
Do not invent a title, an `**Escalation:**` field, or a `**Justification:**` field — the parser
only reads the `## ` heading line and the first `ratified-as:` line inside that block; anything
else you add is harmless but the two lines above are the only ones that matter and they must be
byte-exact.
MD
cat > "$HOME_DIR/watchdog/status.json" <<JSON
{"v":1,"pid":999999,"home":"$HOME_DIR","startedAt":"1970-01-01T00:00:00.000Z","updatedAt":"1970-01-01T00:00:00.000Z","mode":"follow","runnerPid":null,"terminal":{"status":"needs_human","reason":"escalations_pending","exitCode":2}}
JSON
cat > "$HOME_DIR/campaign-report.json" <<JSON
{
  "run": {"reason": "escalations_pending", "unratifiedRulings": []},
  "cards": {"c1": {"outcome": "escalated", "escalationFile": "escalations/c1.md", "question": "generic-ruling-needed", "autoAnswerRounds": 0}},
  "pending": [],
  "stats": {"shipped": 0, "escalated": 1, "blocked": 0, "notReached": 0}
}
JSON

echo "test-supervisor-real-e2e.sh: home=$HOME_DIR repo=$REPO slug=$SLUG"

# --- Step 1: the real, unattended run — one bare command, no session held open --------------
set +e
out="$(bun "$RUNNER/run.ts" supervise --repo "$REPO" --home "$HOME_DIR" \
  --model haiku --watchdog-model haiku --max-spawns 4 --session-timeout-seconds 600 2>&1)"
rc=$?
set -e
echo "$out"
echo "exit=$rc"

check "step1: supervise exits 0" "$rc" "0"
absent "step1: NEEDS_OWNER.md does not exist" "$HOME_DIR/NEEDS_OWNER.md"
if [[ "$(grep -c '^## ' "$HOME_DIR/answers.md" 2>/dev/null || echo 0)" -ge 1 ]]; then
  ok "step1: answers.md gained at least one ## block"
else
  bad "step1: answers.md gained at least one ## block"
fi
if compgen -G "$HOME_DIR/escalations/c1.md.resolved-*" > /dev/null; then
  ok "step1: the escalation file is archived"
else
  bad "step1: the escalation file is archived"
fi
if [[ -s "$HOME_DIR/supervisor/final-report.md" ]]; then
  ok "step1: supervisor/final-report.md exists and is non-empty"
else
  bad "step1: supervisor/final-report.md exists and is non-empty"
fi

# --- Step 2: G5 — assert the ledger mechanically ---------------------------------------------
LEDGER_OUT="$(python3 - "$HOME_DIR/supervisor/ledger.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
need = {"kind","sessionId","model","startedAt","endedAt","usage","verdict"}
assert rows, "the ledger is empty"
for r in rows:
    assert need <= set(r), f"missing {need - set(r)}"
    assert r["model"] == "haiku", r["model"]
    assert r["verdict"] in {"ruled","ratified","closed","parked","failed","timeout"}
print(f"ledger ok: {len(rows)} spawns, kinds={[r['kind'] for r in rows]}")
PY
)"
echo "$LEDGER_OUT"
N_SPAWNS="$(python3 -c "import json,sys; print(len([json.loads(l) for l in open(sys.argv[1]) if l.strip()]))" "$HOME_DIR/supervisor/ledger.jsonl")"
if [[ "$N_SPAWNS" -ge 1 && "$N_SPAWNS" -le 4 ]]; then
  ok "step2: G5 ledger has between 1 and 4 spawns"
else
  bad "step2: G5 ledger has between 1 and 4 spawns (got: $N_SPAWNS)"
fi
if grep -q '"verdict":"failed"\|"verdict":"timeout"' "$HOME_DIR/supervisor/ledger.jsonl"; then
  bad "step2: G5 ledger has no failed/timeout verdict"
else
  ok "step2: G5 ledger has no failed/timeout verdict"
fi

# --- Step 3: G0 — assert the ratchet, and WRITE the measured ceilings (S-P15) ----------------
SESSION_FLAGS=()
while IFS= read -r sid; do
  [[ -n "$sid" ]] && SESSION_FLAGS+=(--session "$sid")
done < <(python3 -c 'import json,sys
for l in open(sys.argv[1]):
    l=l.strip()
    if l: print(json.loads(l)["sessionId"])' "$HOME_DIR/supervisor/ledger.jsonl")

(cd "$RUNNER" && bun run.ts transcript-metrics "${SESSION_FLAGS[@]}" --json) > "$TMP/e2e-metrics.json"

RATCHET_OUT="$(python3 - "$TMP/e2e-metrics.json" "$HOME_DIR/supervisor/ledger.jsonl" \
  "$REPO_ROOT/docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json" <<'PY'
import json, math, sys
metrics, ledger, ratchet_path = sys.argv[1], sys.argv[2], sys.argv[3]
m = {s["sessionId"]: s for s in json.load(open(metrics))["sessions"]}
kind = {json.loads(l)["sessionId"]: json.loads(l)["kind"] for l in open(ledger) if l.strip()}
for sid, s in m.items():
    assert s["babysittingShare"] == 0, (sid, s["babysittingShare"])
    assert s["monitorArms"] == 0, (sid, s["monitorArms"])
r = json.load(open(ratchet_path)); f = r["headroomFactor"]
peak = {}
for sid, s in m.items():
    k = kind.get(sid, "ruling")
    peak[k] = max(peak.get(k, 0), s["maxContext"])
for k, v in peak.items():
    r["ceilings"][k] = math.ceil(v * f)
r["source"] = f"measured by task 20 from {len(m)} session(s); factor {f}"
json.dump(r, open(ratchet_path, "w"), indent=2)
print("measured maxima:", peak, "-> ceilings:", r["ceilings"])
PY
)"
echo "$RATCHET_OUT"
ok "step3: G0 ratchet — every session babysittingShare==0 and monitorArms==0, ceilings written"

RATCHET_JSON="$REPO_ROOT/docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json"

# --- Step 3a: re-run the ceiling gate against the file Step 3 just wrote ---------------------
set +e
CEIL_TEST_OUT="$(cd "$RUNNER" && bun test core/metrics/ceiling.test.ts 2>&1)"
CEIL_RC=$?
set -e
echo "$CEIL_TEST_OUT"
check "step3a: ceiling.test.ts passes against the just-measured (non-zero) ceilings" "$CEIL_RC" "0"

# Only the ratchet json may have moved under docs/superpowers/evidence/ — the diff --stat itself
# is echoed into the evidence file below; the assertion here checks the file SET, not the hunks.
DIFF_NAMES="$(git -C "$REPO_ROOT" diff --name-only -- docs/superpowers/evidence/)"
check "step3a: only the ratchet json changed under docs/superpowers/evidence/" \
  "$DIFF_NAMES" "docs/superpowers/evidence/2026-09-18-supervisor-ratchet.json"
DIFF_STAT_OUT="$(git -C "$REPO_ROOT" diff --stat -- "$RATCHET_JSON")"
echo "$DIFF_STAT_OUT"

# --- Step 4: G6 — the reproducible half (project-directory listing; no viewer/screenshot here,
# per the plan's own adjudication rule — the Warchief takes the screenshot separately since it
# needs a browser) --------------------------------------------------------------------------
PROJECT_DIRS="$(ls -d ~/.claude/projects/*"$SLUG"* 2>/dev/null || true)"
N_PROJECT_DIRS="$(printf '%s\n' "$PROJECT_DIRS" | grep -c . || true)"
check "step4: exactly one ~/.claude/projects dir ends in the campaign slug" "$N_PROJECT_DIRS" "1"
PROJECT_DIR="$(printf '%s\n' "$PROJECT_DIRS" | head -1)"
JSONL_COUNT="$(ls -1 ~/.claude/projects/*"$SLUG"*/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${JSONL_COUNT:-0}" -ge 1 ]]; then
  ok "step4: the project dir holds >= 1 .jsonl transcript (one per spawn)"
else
  bad "step4: the project dir holds >= 1 .jsonl transcript (one per spawn) (got: ${JSONL_COUNT:-0})"
fi
echo "step4: project dir=$PROJECT_DIR jsonl_count=${JSONL_COUNT:-0}"

# --- Step 5: WRITE the evidence file from THIS run's live outputs, before the EXIT trap -------
# deletes $TMP/$TRIBE_HOME. cat_or_missing never fails the whole write over one absent file — the
# Warchief inspects a MISSING line rather than losing every other section to a set -e abort.
cat_or_missing() {
  if [[ -f "$1" ]]; then cat "$1"; else printf 'MISSING: %s\n' "$1"; fi
}

EVIDENCE="$REPO_ROOT/docs/superpowers/evidence/2026-09-18-campaign-supervisor-e2e.md"
{
  printf '# Campaign-supervisor real end-to-end run — G1, G5, G6 (Task 20)\n\n'
  printf 'Generated by the billed run of `test-supervisor-real-e2e.sh` (`TRIBE_REAL_E2E=1`) and\n'
  printf 'committed so every PR link resolves from the repo itself. Never hand-adjusted.\n\n'

  printf '## BEFORE — the Task 4 baseline (one campaign, un-supervised)\n\n'
  printf 'Source: `docs/superpowers/evidence/2026-09-18-supervisor-baseline.json` and\n'
  printf '`docs/superpowers/evidence/2026-09-18-supervisor-baseline.md`.\n\n'
  printf '| Fact | `6a8a8fe4-…` (viewer-consolidation) |\n'
  printf '| --- | --- |\n'
  printf '| Model turns | 174 (plan Task 20 Step 5 figure; the R7-corrected reducer measures 173 in the committed baseline file — see baseline.md "Fix round (R7)") |\n'
  printf '| Cache-read tokens | 26.5M (26,469,777) |\n'
  printf '| Babysitting share | 0.3168 |\n'
  printf '| Rulings this session produced | R16, R18, R22 (per plan Task 19'"'"'s own quote of this session'"'"'s escalation history), plus its closing |\n\n'

  printf '## AFTER — this run\n\n'
  printf '**Command:**\n\n```sh\nbun plugins/tribe/scripts/runner/run.ts supervise --repo "%s" --home "%s" \\\n' "$REPO" "$HOME_DIR"
  printf '  --model haiku --watchdog-model haiku --max-spawns 4 --session-timeout-seconds 600\n```\n\n'
  printf '**Exit code:** `exit=%s`\n\n' "$rc"

  printf '### `supervisor/status.json`\n\n```json\n%s\n```\n\n' "$(cat_or_missing "$HOME_DIR/supervisor/status.json")"
  printf '### `supervisor/events.jsonl`\n\n```\n%s\n```\n\n' "$(cat_or_missing "$HOME_DIR/supervisor/events.jsonl")"
  printf '### `supervisor/ledger.jsonl`\n\n```\n%s\n```\n\n' "$(cat_or_missing "$HOME_DIR/supervisor/ledger.jsonl")"

  printf '### Step 2 — G5 ledger assertion output\n\n```\n%s\n```\n\n' "$LEDGER_OUT"
  printf '### Step 3 — G0 ratchet assertion output\n\n```\n%s\n```\n\n' "$RATCHET_OUT"
  printf '### Step 3a — ceiling gate re-run + diff\n\n```\n%s\n\n%s\n```\n\n' "$CEIL_TEST_OUT" "$DIFF_STAT_OUT"
  printf '### Step 4 — G6 project-directory listing (reproducible evidence)\n\n```\n%s\njsonl_count=%s\n```\n\n' \
    "$PROJECT_DIR" "${JSONL_COUNT:-0}"

  printf '### `supervisor/final-report.md`\n\n```\n%s\n```\n' "$(cat_or_missing "$HOME_DIR/supervisor/final-report.md")"
} > "$EVIDENCE"
if [[ -s "$EVIDENCE" ]]; then
  ok "step5: the evidence file was written and is non-empty"
else
  bad "step5: the evidence file was written and is non-empty"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
