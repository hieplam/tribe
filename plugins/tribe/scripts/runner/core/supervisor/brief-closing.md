# Closing Brief — the one final owner report

## Role and authority

You are the closing session for this campaign. You have `Bash` and read access to the target
repo: you re-verify every shipped card with `verify-shipped` and write the one owner report. You
land no PR.

Your working directory is the owner's own checkout of the target repo: never switch its branch, stage, commit or edit files in it — land any repo change from a separate `git worktree`.

## The oracle

`SKILL.md` Stage D below is the question. The final `campaign-report.json` is the evidence.

## `SKILL.md`, Stage D — The one final owner report, verbatim (all three numbered steps)

1. **For every card the report marks `shipped`, independently re-verify it before repeating the
   claim.** Invoke the **`verify-shipped` skill by name** (never by reading or calling its script
   path directly — depend on its contract, not its implementation) with `--skip-gap-gate`, that
   card's `pr` and its worktree path. This is the design's no-cascade read: the runner's own claim
   that a card shipped is not evidence on its own. Treat a `verify-shipped` failure as `blocked`,
   not `shipped`, in your final report.
2. **You can also recover which commits belong to this campaign directly from git.** Every
   commit a card's executor session made should carry a `Campaign: <campaign-slug>` git trailer
   — the runner's executor brief instructs it (see the runner README's "Campaign commit
   trailer" section). `git log --grep="Campaign: <campaign-slug>"` in `<target-repo>` lists
   them. **This is instructional, not verified**: neither the D3 checks the runner replays nor
   `verify-shipped` confirm the trailer is present, so a missing trailer is a documentation gap
   worth noting, never proof a card didn't ship — `verify-shipped` (item 1) stays the actual
   acceptance gate.
3. **Compose ONE report** to the owner, covering every card in the campaign:
   - **Shipped** — PR number, merge sha, and the `verify-shipped` verdict.
   - **Escalated / blocked** — the question (or `blockedOn` dependency), why it needs the owner,
     and how many auto-answer rounds it already used.
   - Overall `stats` (shipped / escalated / blocked / not-reached counts) and pointers to the
     report files and escalation files, so the owner can go deeper without you re-deriving
     anything.

## The final `campaign-report.json`, verbatim

{{CAMPAIGN_REPORT_CONTENT}}

## The closing verdict — the contract is the verdict FILE, not your prose

The oracle for whether the campaign closes is **the verdict file the `verify-shipped` script
writes, one per shipped card — not the report you compose, and not your own summary.** A report
that says "everything shipped" with no verdict file on disk will NOT close the campaign; the
supervisor's closing postcondition reads each file below and closes only when every one is a
well-formed `PASS` whose `card` field matches. This is `brief-contracts.md`'s rule: prose
persuades, artifacts get run.

Resolve the script once (never hand-write its path — run the bundled resolver, exactly as the
`verify-shipped` skill's own `SKILL.md` instructs):

    script_path="$(bash "<skill-dir>/resolve-verify-shipped.sh")" || exit 1

Then, for every card the report marks `shipped`, run it with `--verdict-out` at the exact path the
supervisor will read:

{{SHIPPED_VERDICTS}}

## Where to write the owner-facing report

Write the report Stage D step 3 composes to:

{{FINAL_REPORT_PATH}}
