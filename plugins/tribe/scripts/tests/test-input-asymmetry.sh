#!/usr/bin/env bash
# test-input-asymmetry.sh — contract tripwire for the input-asymmetric Skinner pair (idea 03).
#
# TRIPWIRE, not a behavior test: it proves the delta-laws are WRITTEN into the agent prompts and
# fails loudly if a later edit deletes one. Behavior is proved by the evals in
# plugins/tribe/evals/evals.json. Offline, no network.
#
# Idea 03 is a DELTA on idea 01 (the dual-Skinner cell). The baseline assertions below are the
# dependency check: run this before idea 01 has landed and you get a clear failure, not a silent
# no-op edit.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS="$HERE/../../agents"
WARCHIEF="$AGENTS/warchief.md"
SKINNER="$AGENTS/skinner.md"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }

# Agent prompts are hard-wrapped prose, so a sentence routinely straddles a newline; grep is
# line-based and would miss it. Flatten each haystack to one whitespace-normalized line so the
# assertions match meaning, not line-breaking accidents.
flat() { tr '\n' ' ' | tr -s ' '; }

has() { # has NAME HAYSTACK REGEX — the flattened text must contain the regex
  if grep -qiE "$3" <<<"$2"; then ok "$1"; else bad "$1 (missing: $3)"; fi
}
hasnt() { # hasnt NAME HAYSTACK REGEX — the flattened text must NOT contain the regex
  if grep -qiE "$3" <<<"$2"; then bad "$1 (found what must be gone: $3)"; else ok "$1"; fi
}

[[ -f "$WARCHIEF" ]] || { printf 'not ok - warchief.md not found\n'; exit 1; }
[[ -f "$SKINNER" ]]  || { printf 'not ok - skinner.md not found\n'; exit 1; }

SKINNER_ALL="$(flat < "$SKINNER")"

# The cold-lens rules must live in their OWN section, so assert against that section only —
# never against the whole file. skinner.md already says "self-refutation", "contract",
# "UN-AUDITABLE" etc. in its contract-lens Method, so a whole-file grep would go green before a
# single edit was made: a tripwire that passes on the unmodified file guards nothing.
LENS="$(awk '/^## Lens mode/{f=1} /^## Operating rules/{f=0} f' "$SKINNER" | flat)"

# --- Dependency check: idea 01's baseline must already be in place -------------------------
if ! grep -qiE 'law 1' "$WARCHIEF"; then
  printf 'not ok - DEPENDENCY: idea 01 baseline (labelled Laws in step 6) not found in warchief.md\n'
  printf '# idea 03 is a delta on idea 01. Land idea 01 first. Aborting.\n'
  exit 1
fi
ok "dependency: idea 01 baseline present in warchief.md"

# --- Task 1 — skinner.md cold-lens mode ----------------------------------------------------
# (Before Task 1's edit, "$LENS" is the empty string and every assertion below fails. That is the
# RED state, and it is the point.)

# The lens switch itself.
has "cold: skinner.md declares a lens mode (contract | cold)" "$LENS" 'lens: contract|lens: cold'
has "cold: the cold lens is named and described"             "$LENS" 'cold lens|bare-diff reviewer'
has "cold: contract lens is the default"                     "$LENS" 'contract.{0,30}default|default.{0,30}contract'

# The load-bearing suspension: having no contract is the ASSIGNMENT in cold mode, not a failure.
has "cold: the contract hunt is suspended"                   "$LENS" 'suspend'
has "cold: UN-AUDITABLE never applies in cold mode"          "$LENS" 'never return .?UN-AUDITABLE|UN-AUDITABLE.{0,80}cold'

# The cold lens must not go looking for the contract it was denied.
has "cold: must not read a spec/plan/card found on disk"     "$LENS" 'must not read'

# The verdict boundary: cold mode emits COLD-LENS:, never AUDIT:.
has "cold: emits a COLD-LENS terminator line"                "$LENS" 'COLD-LENS: [0-9N]+ hypothes'
has "cold: is forbidden from emitting an AUDIT line"         "$LENS" 'never emit an .?AUDIT:'
has "cold: findings are hypotheses, not a verdict"           "$LENS" 'not a verdict|hold no PASS/FAIL'

# Anti-Goodhart: zero hypotheses is honorable, and self-refutation still applies in full.
has "cold: zero hypotheses is an honorable result"           "$LENS" '0 hypotheses|zero hypotheses'
has "cold: self-refutation still applies in cold mode"       "$LENS" 'self-refutation'

# The one edit OUTSIDE the new section: Method step 1's UN-AUDITABLE stop must point at cold mode,
# so the two passages cannot contradict each other.
has "cold: Method step 1 carves out the cold lens"           "$SKINNER_ALL" 'contract lens only|in .?lens: cold.? this whole step is suspended'

# F-H1: the CONTAMINATED refusal ("Return AUDIT: FAIL — CONTAMINATED", Operating rules) and cold
# mode's "never emit an AUDIT: line" rule are two orders that would otherwise contradict each other
# on exactly a contaminated COLD dispatch. An explicit precedence sentence must settle it — checked
# against the WHOLE file because the carve-out spans both the Lens-mode section and Operating rules,
# which sit outside the $LENS window (Operating rules starts AFTER "## Lens mode" ends).
# REPOINTED (idea-11 task-1): the precedence rule now covers EVERY lens, not just cold — it says
# "Precedence over every lens's no-AUDIT: rule" and names the contamination refusal as the one and
# only AUDIT: line ANY lens may ever emit.
has "H1: contaminated refusal is declared to win over every lens's no-AUDIT rule" \
  "$SKINNER_ALL" 'precedence over every lens.?s no-.?AUDIT:.? rule|the one and only .?AUDIT:.? line ANY lens may ever emit'

# --- Task 2 — warchief.md step 6, Delta-Law 1: two lenses, two briefs ----------------------
STEP6="$(awk '/^### 6\./{f=1} /^### 7\./{f=0} f' "$WARCHIEF" | flat)"
[[ -n "$STEP6" ]] || { printf 'not ok - could not extract step 6 from warchief.md\n'; exit 1; }

has   "law1: the two lenses are named"                        "$STEP6" 'contract lens.{0,200}cold lens|cold lens.{0,200}contract lens'
has   "law1: each dispatch declares its lens"                 "$STEP6" 'lens: contract|lens: cold'
has   "law1: the briefs are NOT identical"                    "$STEP6" 'deliberately .{0,4}not identical'
hasnt "law1: the identical-brief clause is gone"              "$STEP6" 'identical brief'
has   "law1: still one message, still concurrent"             "$STEP6" 'same message'
has   "law1: cold brief carries the bare diff only"           "$STEP6" 'only the bare diff|bare diff'
has   "law1: cold brief must not carry the spec/plan"         "$STEP6" 'the spec, the plan, the idea card, a ticket, or any path to them'
has   "law1: cold brief must not carry the Hunter report"     "$STEP6" "hunter's report, its reasoning, its red proof, its self-assessment"
has   "law1: cold brief must not carry commit/branch/PR text" "$STEP6" 'commit message|branch name|PR body'
has   "law1: the cold lens may still read the codebase"       "$STEP6" 'not blind to the codebase|may read'

# --- Task 3 — Delta-Law 3 (tags + disposition) and Delta-Law 4 (round-PASS rule) -----------
# Repetition bounds capped at {0,200} (not {0,300}/{0,400}) to match this file's own convention
# (see the {0,200} bounds already used by the law1 assertions above): BSD grep (the /usr/bin/grep
# this repo's contributors actually run) rejects any {m,n} with n > 255 ("maximum repetition
# exceeds 255"), so a wider bound would make the assertion never executable, on any content.
has   "law3: three-tag vocabulary"                             "$STEP6" '\[both\].{0,200}\[contract-only\].{0,200}\[cold-only\]'
# REPOINTED (idea-11 task-1): "cold findings are hypotheses" now lives in Law 1's own dispatch
# description (Skinner B holds the cold lens and returns hypotheses only), not a separate Law 3
# sentence.
has   "law3: cold findings are hypotheses"                     "$STEP6" 'cold lens.{0,20}returns hypotheses only'
# REPOINTED: the disposition is now recorded into "the disposition ledger in your report file",
# not just "your report file" bare, and it covers every merged finding (cold hypotheses included),
# not a cold-only carve-out.
has   "law3: every merged finding, cold hypotheses included, gets a recorded disposition" "$STEP6" \
    'recorded disposition, written into the disposition ledger in your report file'
# REPOINTED: CONFIRMED/REFUTED/DEBT replaced the old two-value vocabulary. The gap between the
# first REFUTED and DEBT exceeds BSD grep's 255-char repetition ceiling, so this is anchored on the
# second, closer "evidence-free REFUTED" occurrence instead (same file convention as
# test-disagreement-routing.sh's D17 bridge-sizing rule).
has   "law3: CONFIRMED and REFUTED are named"                  "$STEP6" 'confirmed.{0,150}refuted'
has   "law3: DEBT is the third named disposition"              "$STEP6" 'evidence-free refuted.{0,80}debt'
has   "law3: refuting needs evidence about the CODE"           "$STEP6" 'evidence that the code is correct|evidence about the code'
has   "law3: the contract-does-not-require-it refutation is forbidden" "$STEP6" 'contract does not require'
has   "law3: an undispositioned hypothesis fails the round"    "$STEP6" 'undispositioned|silence is not a disposition'
# REPOINTED (idea-11 task-1): the contract lens no longer holds any verdict either — Law 4's title
# is now "the adjudication: no lens holds a verdict; you do", and the audit-close condition
# replaces the old both-must-PASS rule with a three-part CLOSES-iff test the Warchief evaluates.
has   "law4: no lens holds a verdict, not even the contract lens"  "$STEP6" 'no lens holds a verdict.{0,10}you do'
has   "law4: the audit-close condition is stated in full"      "$STEP6" 'audit CLOSES if and only if all three hold'
hasnt "law4: the both-must-PASS rule is gone"                  "$STEP6" 'pass needs both|passes only if both skinners'
has   "law4: the 3-round cap is untouched"                     "$STEP6" '3-round fix cap|3 fix-rounds'

# F10 — the pre-Lens-mode persona and "scope: review only" section are never suspended for cold
# mode by anything in the Method's replace-list ("these rules REPLACE the corresponding parts of
# the Method below" only scopes to the Method, which comes AFTER; the persona and scope-only
# section sit BEFORE "## Lens mode" and were never carved out). An explicit precedence sentence
# must settle it, checked against $LENS since that is where the sentence lives.
has "F10: pre-Lens-mode persona/scope text is declared contract-lens only" \
  "$LENS" 'persona.{0,200}scope: review only.{0,200}contract lens only'

# --- F-H4 — evals.json ids 10-12 must stay asymmetric-design content, not the superseded --------
# pre-asymmetry claims (idea 01's evals 10/11/12 were REWRITTEN, correctly, to match the shipped
# asymmetric design; nothing else in the suite guards that content, so a silent revert would pass
# every other test). Offline: read the file with python3, no network.
EVALS="$HERE/../../evals/evals.json"
[[ -f "$EVALS" ]] || { printf 'not ok - evals.json not found\n'; exit 1; }

eval_checks() {
  python3 - "$1" <<'PY'
import json, sys

path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
evals = data.get("evals", [])
ids = [e.get("id") for e in evals]
by_id = {e.get("id"): e for e in evals}

def out(name, ok):
    print(("OK " if ok else "BAD ") + name)

out("evals-file-has-52-evals", len(evals) == 52)
out("evals-file-ids-are-unique", len(ids) == len(set(ids)))

e10 = (by_id.get(10) or {}).get("expected_output", "").lower()
e11 = (by_id.get(11) or {}).get("expected_output", "").lower()
e12 = (by_id.get(12) or {}).get("expected_output", "").lower()

out("eval10-present", 10 in by_id)
out("eval11-present", 11 in by_id)
out("eval12-present", 12 in by_id)

# Must reflect the shipped asymmetric design (two named lenses, not one shared brief).
out("eval10-names-both-lenses", "lens: contract" in e10 and "lens: cold" in e10)
out("eval12-names-both-lenses", "lens: contract" in e12 and "lens: cold" in e12)

# Must NOT still assert idea 01's superseded, now-contradicted pre-asymmetry claims.
out("eval10-no-longer-claims-identical-briefs",
    "does not assign the two reviewers different lenses" not in e10
    and "both briefs are identical" not in e10)
out("eval11-no-longer-claims-both-must-pass",
    "pass requires both" not in e11)
out("eval12-no-longer-claims-identical-briefs",
    "identical, isolated briefs" not in e12)
PY
}
EVAL_CHECKS="$(eval_checks "$EVALS")"

while IFS= read -r _line; do
  [[ -n "$_line" ]] || continue
  _status="${_line%% *}"
  _name="${_line#* }"
  if [[ "$_status" == "OK" ]]; then ok "eval-content: $_name"; else bad "eval-content: $_name"; fi
done <<<"$EVAL_CHECKS"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
