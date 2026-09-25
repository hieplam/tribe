#!/usr/bin/env bash
# A campaign's operational files (state, answers, escalations, reports, progress notes) live only
# in the campaign home, ~/.tribe/<repo-key>/campaigns/<slug>/ — never tracked in the repo.
# Governing rule: docs/superpowers/specs/2026-08-01-campaign-state-home-migration-design.md §2.
# Durable decisions belong in docs/tribe/ROADMAP.md's Decision Log instead.
set -euo pipefail
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }

# Tracked paths that are campaign operational state. The runner's own test fixtures are test
# data, not a campaign, so they are allowed.
OPERATIONAL='(^|/)(campaign-state\.json|campaign-report\.(json|md)|answers\.md)$|(^|/)escalations/|^\.claude/state/|^docs/tribe/(campaigns|state)/'
ALLOWED='^plugins/tribe/scripts/runner/fixtures/'
operational_paths(){ git -C "$1" ls-files | grep -E "$OPERATIONAL" | grep -vE "$ALLOWED" || true; }

# The check itself: it must catch a planted file and allow a fixture (so an empty check cannot pass).
probe="$TMP/probe"; git init --template= -q -b master "$probe"
mkdir -p "$probe/docs/tribe/campaigns/x" "$probe/plugins/tribe/scripts/runner/fixtures/y"
: > "$probe/docs/tribe/campaigns/x/answers.md"; : > "$probe/plugins/tribe/scripts/runner/fixtures/y/answers.md"
git -C "$probe" add -A
[ "$(operational_paths "$probe")" = "docs/tribe/campaigns/x/answers.md" ] \
  && ok "the check flags a tracked answers.md and allows the runner fixtures" \
  || bad "the check flags a tracked answers.md and allows the runner fixtures"

found="$(operational_paths "$REPO")"
if [ -z "$found" ]; then ok "the repo tracks no campaign operational files"
else bad "the repo tracks campaign operational files (move them to the campaign home):"; printf '    %s\n' $found; fi
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"; [[ "$FAIL" -eq 0 ]]
