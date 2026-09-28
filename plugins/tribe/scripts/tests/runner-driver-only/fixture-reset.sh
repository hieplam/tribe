#!/usr/bin/env bash
# fixture-reset.sh — returns the Go fixture repo to a recorded starting TREE, without rewriting
# history (card runner-driver-only, spec §6.2). The BEFORE and AFTER runs must start from the same
# tree; a force-push would also do that, but it destroys the BEFORE run's merge history, which is
# evidence. So this lands ONE ordinary commit on master whose tree is byte-identical to the
# starting commit's tree, and proves it (`<head>^{tree} == <start>^{tree}`).
#
# Usage: fixture-reset.sh <fixture-clone> <start-sha>
# Refuses (exit 1, nothing pushed) when: the clone is not on master, is dirty, has a linked
# worktree, or the GitHub repo has an open PR (a run is still in flight). Deletes every remote
# branch except master (a finished run's leftovers), then commits the start tree when HEAD's tree
# differs, pushes, and prints `RESET_OK head=<sha> tree=<tree>`.
set -euo pipefail

bounded() { perl -e 'alarm shift; exec @ARGV or die "exec: $!"' 120 "$@"; }
die() { printf 'fixture-reset: %s\n' "$*" >&2; exit 1; }

[[ $# -eq 2 ]] || die "usage: fixture-reset.sh <fixture-clone> <start-sha>"
clone="$1"
start="$2"
[[ -d "$clone/.git" ]] || die "$clone is not a git clone"
# Host git config is off (fail-closed-edges obligation 2). That also drops the credential helper of a
# git build that keeps it in the system config (Homebrew's; Apple's carries its own), and the fixture
# remote is private — so the one helper this script needs is named explicitly: `gh`, already required
# below for `gh pr list`.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0='!gh auth git-credential'
g() { bounded git -C "$clone" -c user.name='runner-driver-only fixture' -c user.email='fixture@invalid' "$@"; }

[[ "$(g rev-parse --abbrev-ref HEAD)" == "master" ]] || die "$clone is not on master"
[[ -z "$(g status --porcelain)" ]] || die "$clone has uncommitted changes"
[[ "$(g worktree list --porcelain | grep -c '^worktree ')" == "1" ]] || die "$clone has a linked worktree (a run may still be in flight)"
open_prs="$(cd "$clone" && bounded gh pr list --state open --json number --jq 'length')"
[[ "$open_prs" == "0" ]] || die "$open_prs open PR(s) on the fixture repo (a run may still be in flight)"

g fetch --prune origin
g merge --ff-only origin/master
g cat-file -e "${start}^{commit}" || die "start commit $start is not in $clone"

for branch in $(g ls-remote --heads origin | awk '{print $2}' | sed 's#^refs/heads/##'); do
  [[ "$branch" == "master" ]] && continue
  g push origin --delete "$branch"
done

want_tree="$(g rev-parse "${start}^{tree}")"
if [[ "$(g rev-parse 'HEAD^{tree}')" != "$want_tree" ]]; then
  g read-tree -u --reset "$start"
  g commit -q -m "chore: restore the starting tree of ${start:0:7} (runner-driver-only fixture reset)"
  g push -q origin master
fi

head="$(g rev-parse HEAD)"
tree="$(g rev-parse 'HEAD^{tree}')"
[[ "$tree" == "$want_tree" ]] || die "tree after reset is $tree, want $want_tree"
[[ "$(g rev-parse origin/master)" == "$head" ]] || die "origin/master is not $head after the push"
printf 'RESET_OK head=%s tree=%s\n' "$head" "$tree"
