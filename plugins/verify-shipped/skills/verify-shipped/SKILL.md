---
name: verify-shipped
description: Use whenever a Warchief (or anyone) reports a piece of work as SHIPPED and that claim needs verifying before it's trusted — before marking a roadmap card shipped, before telling the owner a PR landed, or any time "done" needs mechanical proof instead of a prose report. Runs four checks against GitHub and git — PR state == merged, local master in sync with origin/master, worktree removed, and the merged PR body carries this card's gap-gate v1 stamp — and prints a pass/fail verdict on each. Trigger on phrases like "is this actually shipped?", "verify SHIPPED", "did this really merge?", "check the PR landed", "confirm done". Encodes the owner's own Definition of Done ("PR merged and ready to work on new feature with LATEST CHANGES") as a script instead of trusting a claim.
---

# Verify Shipped

A Definition-of-Done gate. The owner's global CLAUDE.md already states what "done" means:
**PR merged and ready to work on new feature with LATEST CHANGES.** Nothing in this repo
checked that mechanically before — `SHIPPED` was just a status string a Warchief (or anyone)
asserted in prose. This skill turns that assertion into four cheap, scripted checks.

## When to invoke

- Whenever a report claims work is `SHIPPED` and you (or the Shaman) are about to trust it —
  in the tribe, this is the Shaman's "verify SHIPPED from evidence only" step after a Warchief
  returns `SHIPPED`.
- Before telling the owner a PR landed and it's safe to start the next thing.
- Any time you want a mechanical second opinion on "did this actually merge and clean up after
  itself" instead of re-deriving the check by reading PR pages and git log by hand.

## What it checks

Four independent checks, each reported pass/fail (or `unknown` when the data needed to decide
isn't available):

1. **`pr_merged`** — the PR's state is `MERGED` (via `gh pr view`).
2. **`master_in_sync`** — the local base branch (default `master`) has zero commits ahead and
   zero behind `origin/<base>` after a fetch. This is the "ready to work on new feature with
   LATEST CHANGES" half of the owner's definition.
3. **`worktree_removed`** — the given worktree path is gone from both disk and
   `git worktree list`.
4. **`gap_gate_stamped`** — the merged PR's body carries a `gap-gate v1` stamp whose `card=`
   matches `--card`. This is the attended-session backstop for a PR opened by a session that
   bypassed the Warchief and so never ran the gap gate; it deliberately does not re-check sha
   ancestry (that is the campaign runner's job, which has the merged repo in hand).

## Usage

```bash
bash ~/.claude/skills/verify-shipped/scripts/verify-shipped.sh --pr <number|url> --worktree <path> --card <slug> [--base master] [--repo owner/repo]
```

- `--pr` — required. PR number or full URL.
- `--worktree` — required. The worktree path used for the work being verified. May be relative
  or absolute — the script canonicalizes it against the caller's cwd (before changing directory
  internally) so a relative path is always checked against the right location.
- `--card` — required. The card slug the `gap-gate v1` stamp in the PR body must carry. All
  four checks run every time; there is no partial/optional mode, because a claimed-done state
  with an unchecked corner is exactly the gap this skill exists to close.
- `--base` — optional, defaults to `master`.
- `--repo` — optional; passed to `gh` as `--repo` when not run from inside the target repo's
  checkout, or when `gh`'s own repo inference would pick the wrong remote.

The script prints a JSON summary on stdout only (logs go to stderr) and exits `0` whether the
verdict is `PASS` or `FAIL` — a failed check is a normal result, not a script error. It exits
`2` only on setup problems: `gh`/`git`/`python3` missing, not a git repo, or the PR/repo
couldn't be resolved (bad PR number, no `gh` auth, etc.).

Read the top-level `verdict` field (`PASS` only when all four checks pass) and each check's
`detail` string — that's what explains *why* a check failed, not just that it did.

## Example

```
$ bash ~/.claude/skills/verify-shipped/scripts/verify-shipped.sh --pr 37 --worktree /tmp/wt-card4 --card card4 --repo hieplam/tribe
{
  "pr_number": "37",
  "base_branch": "master",
  "worktree": "/tmp/wt-card4",
  "card": "card4",
  "checks": {
    "pr_merged": {"status": "pass", "detail": "PR #37 state is MERGED"},
    "master_in_sync": {"status": "pass", "detail": "local master == origin/master"},
    "worktree_removed": {"status": "pass", "detail": "/tmp/wt-card4 is gone from disk and from git worktree list"},
    "gap_gate_stamped": {"status": "pass", "detail": "gap-gate v1 stamp present for card card4 (minted=none matched=none)"}
  },
  "verdict": "PASS"
}
```

## When this skill should NOT trigger

- Verifying a claim that isn't about a merged-PR end-state (e.g. "is this function correct?",
  "did the tests pass?") — those are a coverage tool's or the test suite's job, not this
  one.
- The PR doesn't exist yet, or is still open — there is nothing to verify; `pr_merged` will
  correctly report `fail`, but running the script before a PR exists is premature.
- You don't have `gh` authenticated against the repo in question — the script will exit `2`
  rather than guess.

## Files in this skill

- `scripts/verify-shipped.sh` — runs the four checks, emits a JSON summary. Requires `gh`
  (authenticated), `git`, and `python3` (used only to emit well-formed JSON).
