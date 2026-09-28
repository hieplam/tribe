# rdo-cleanup — design

Campaign `post-rdo-followups`, card 2 of 2. Owner ruling P2 (2026-09-28): the "Cleanup" group of
the follow-ups left by card `runner-driver-only`, which is backlog items 2.2, 2.3 and 2.9.

## Where things stand

Card `runner-driver-only` (PRs #183–#188) removed the supervisor's ratify step: the runner no
longer exits `5` / `rulings_unratified`, the supervisor has two one-shot session kinds (`ruling`,
`closing`), and the runner's report no longer carries `run.unratifiedRulings`
(`core/report.ts`'s `ExitReason` is `done | stop_requested | escalations_pending |
session_incomplete | error`). Three leftovers still describe the old world:

1. **Dead parse (2.2).** `core/supervisor/loop.ts:359` reads `run.unratifiedRulings` from the
   campaign report, and `core/supervisor/model.ts:73` types it. Nothing decides on it. Five test
   fixtures, plus the report fixture in `tests/test-supervisor-park-truth.sh:107`, still write it.
   Baseline: 14 lines across `plugins/tribe/scripts` (`*.ts`, `*.sh`, excluding `node_modules`).
2. **Stale ratify text (2.3).**
   - `tests/sessions-in-repo/owner-run.sh` seeds `answers.md` with a `ratified-as: pending` ruling
     whose only job was to force a `ratify` session. Its comments (line 9, lines 201–219) describe
     that session.
   - `tests/sessions-in-repo/test-owner-run-dry.sh` asserts that seed.
   - `tests/test-supervisor-park-truth.sh:239` lists `rulings_unratified` in the runner's
     exit-reason vocabulary.
   - `runner/fixtures/supervisor/viewer-consolidation-replay/README.md` and its `answers.md`
     describe an unratified R09 ruling that forces a `ratify` session and a spawn bound of 5.
     `core/supervisor/replay.test.ts` already asserts `ruling, ruling, ruling, closing` (≤ 4),
     but its header comment still says "bounded at 5" and "left unratified".
3. **README row (2.9).** `runner/README.md:197` documents `planning` as
   `{ mode: "shaman" | "warchief-fanout" }`. The `orchestrate-campaign` skill writes `"self"` or
   `"subagent-fanout"` in the simple style and keeps `"shaman"` / `"warchief-fanout"` for the Tribe
   style. The runner never reads the field.

## What changes

1. The supervisor stops parsing and typing `run.unratifiedRulings`; every fixture stops writing it.
2. The owner-run harness seeds no ruling at all (the probe card stays unruled, so its ask-first gate
   still fires and the supervisor still spawns its `ruling` session). The dry test asserts
   `answers.md` exists and holds no ruling for `owner-run-probe`. Every stale comment and fixture
   text above is rewritten to describe today's two session kinds and four spawns.
3. The README row lists all four `planning.mode` values and which style writes which.

Behaviour of the runner, supervisor and watchdog does not change. The owner-run harness changes its
seed; its dry test is the check.

## Goals and oracles

| # | Outcome | Oracle | Before → after |
|---|---|---|---|
| C1 | Nothing parses or writes `unratifiedRulings` | grep count over `plugins/tribe/scripts` (`*.ts`, `*.sh`) | 14 → 0 |
| C2 | The named files carry no ratify-step text | grep for `ratify`, `unratified`, `ratified-as: pending`, `bounded at 5` in the six files | > 0 → 0 |
| C3 | The owner-run harness still builds a loadable campaign | `test-owner-run-dry.sh` (runs the runner's own `--dry-run`) | pass → pass |
| C4 | The README row names every mode a skill writes | the `planning` row contains `"self"` and `"subagent-fanout"` | 0 → both |
| C5 | No regression | `bunx tsc --noEmit`, `bun test core/supervisor`, `test-supervisor-docs.sh` | green → green |

Doing nothing fails C1, C2 and C4.

## By design (not findings)

- The viewer keeps the `ratify` session kind (`viewer/core/badge.ts`, `viewer/core/model.ts`,
  `viewer/tools/badge-probe.ts`, `viewer/README.md`), and so does the comment in
  `tests/sessions-in-repo/g8-ledger-tree.ts:207`. Ledgers of older campaigns still hold `ratify`
  rows, so reading them is history, not a stale step.
- `docs/superpowers/specs/2026-09-27-runner-driver-only-design.md` names `unratifiedRulings` as the
  thing it removed. It is a record and stays.
- `tests/test-supervisor-park-truth.sh` is edited but never run. It leaks detached watchdog
  processes (backlog item 2.1, not in this card); `bash -n` is its check.
