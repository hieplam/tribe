# E2 — live tail (spec §16.3, G2)

`live-tail.e2e.test.ts` is the live-tail proof for the viewer-consolidation card: a controlled
writer the test itself owns appends rows to a real, growing transcript and measures
append-to-arrival latency from ITS OWN `performance.now()` — never a transcript row's `timestamp`
field (the model's clock, which can precede the write by seconds) and never a file mtime. 40
samples at irregular intervals, worst sample budgeted at 1000ms, written unconditionally to
`e2e/output/latency.json` (never clamped or discarded, even on a missed budget). In the same run it
also proves: the subagent-append and subagent-appearing-mid-stream cases, the §8.3 follow/scroll
contract on real `scrollTop` readings, the §6.4 live-patch case, reconnect (D12, `window.__viewer*`
hooks) both between a row and its patch and between a call and its result, the >2,000-node window
eviction + "N new below" pill, and same-size rotation. A real `claude -p` Haiku 4.5 session runs
alongside purely as a realism check — no assertion depends on its content, and its absence
(credentials/quota/network) never fails the suite.

Opt-in behind `TRIBE_VIEWER_E2E=1` (`test.skipIf(!ENABLED)`, the same pattern `perf.test.ts` uses)
so a plain `bun test` never spawns a session, writes a transcript, or spends a token:

```sh
cd plugins/tribe/scripts/viewer && bun test                              # skipped, no side effects
cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/live-tail.e2e.test.ts
```

---

## Stale section below — describes a DELETED file, pending a follow-up rewrite

Everything from here down describes `live-viewer.e2e.test.ts`, a pre-viewer-consolidation harness
that task 30 (`docs/tribe/planning/viewer-consolidation/plan.md`) already deleted along with
`e2e/harness.ts`/`e2e/harness.test.ts` (`deletion-guard.test.ts`'s own `DEFERRED_TO_TASK_30` list
names all three). It is left here rather than rewritten because rewriting it is outside this task's
brief (task 31 authorizes adding the E2 entry above only) — a candidate for the campaign's
governance sweep to replace with an index of the CURRENT `e2e/*.e2e.test.ts` files
(`dom-kinds`, `real-transcript`, `served-build`, `url-refusals`, `live-tail`) and what each proves.

# Opt-in end-to-end test (card D4/G5)

`live-viewer.e2e.test.ts` is the only place in this package that proves the live viewer end to
end, against a **real** campaign run — a real throwaway git repo, a real `bun run.ts` process, a
real Claude Agent SDK session, a real subagent dispatch, and real screenshots taken with the
machine's installed Chrome. Nothing here is stubbed, simulated, or hand-written.

## Why it is opt-in

A plain `bun test` (no environment variable) must never start a campaign, never spawn `claude`,
and never spend a token — CI and every ordinary contributor run stays free and instant. This test
is gated behind `TRIBE_VIEWER_E2E=1` (`test.skipIf(!ENABLED)`), so it only runs when a human (or
the Warchief re-verifying evidence) deliberately asks for it.

```sh
cd plugins/tribe/scripts/viewer && bun test              # e2e is SKIPPED, no side effects at all
cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/   # the real run
```

## What it costs

One real Claude Agent SDK session, `--model claude-haiku-4-5-20251001`, capped at
`--session-timeout 6m`. The card is **not** expected to reach `SHIPPED` — the throwaway repo has
no git remote at all, so opening a real PR is impossible by construction (card D4). The point of
the run is the viewer, not the card's outcome: it only needs to get far enough to dispatch one
`hunter` subagent so the live view has a parent session **and** a subagent transcript to render.

## What it does

1. Creates a throwaway target repo under `mkdtemp`, `git init`, one commit, **no remote**
   (`git remote -v` is asserted empty).
2. Authors a campaign home at `$HOME/.tribe/<repoKey>/campaigns/<slug>` — `<repoKey>` is exactly
   what `plugins/tribe/scripts/tribe-home.sh <repo>` prints for the throwaway repo. This has to be
   the *default* tribe root: the runner auto-starts the viewer with only `--port`, so a home
   outside `$HOME/.tribe` would be invisible to it.
3. Stages exactly one card in `campaign-state.json`, validated with a real `--dry-run` first.
4. Commits a trivial spec + plan into the throwaway repo whose Global Constraints and goal
   **require** the executor to dispatch its one implementation task to the `hunter` subagent
   (never inline) — that subagent transcript is the whole point of the second screenshot.
5. Spawns the real `run.ts` (`--viewer-port 4399`, never the default 4321), waits for the
   viewer's `/healthz` identity body, then polls `/api/processes` until a session **and** a
   subagent node both appear.
6. Opens a real SSE connection to `/events` and measures append-to-arrival latency **per
   transcript event**, not per frame (F51): the production poller batches every line written
   since its last 400ms tick into one `append` frame, so a frame can carry several events with
   different true delays. Each event's own `timestamp` (carried on the wire, `core/live/model.ts`)
   is the honest per-line sample — `arrivalMs - Date.parse(event.timestamp)`, which can only ever
   over-state the true delay, never under-state it. The transcript file's mtime is used ONLY as a
   fallback for an event whose `timestamp` is null. Never fabricated, clamped, or discarded — a
   negative sample (clock skew) is reported as measured. The worst sample across all events must
   stay inside the 2000ms budget (card D3/G2).
7. Takes two real screenshots with the machine's installed Chrome
   (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new`) of the live
   parent view and the live subagent view, verifying each is a real, non-trivial PNG.
8. Writes the evidence artifacts below, then tears everything down: kills the runner's process
   group, kills whatever is listening on port 4399 (the viewer, spawned detached by the runner),
   and deletes the throwaway repo. **The campaign home under `$HOME/.tribe` is deliberately never
   deleted** — it is the evidence a reviewer re-inspects.

## What it writes

`docs/superpowers/evidence/2026-09-02-campaign-live-viewer/`:

- `latency.json` — `{ measuredAt, budgetMs, latenciesMs, worstMs, sampleCount, sampleMethods }`.
  `sampleMethods[i]` names how `latenciesMs[i]` was derived — `"timestamp"` (the per-event
  signal, the normal case) or `"mtime-fallback"` (only when that event's `timestamp` was null).
- `processes.json` — the real `/api/processes` payload (a session node and ≥1 subagent node).
- `after-live-parent.png` / `after-live-subagent.png` — real Chrome screenshots of the live page.
- `commands.md` — every command actually run (repo creation, the runner invocation, the printed
  `campaign viewer: <url> (read-only)` line, the Chrome commands), so a reader can reproduce the
  run by hand. `before-status-page.png` is captured separately (it is the status page *before*
  this run starts) and is only referenced here, never created by this harness.

A screenshot that genuinely cannot be captured is never faked or replaced with a placeholder —
`commands.md` records the exact command and its exact stderr under a "Screenshot failure"
heading instead, and the run continues.

## Prerequisites

`bash plugins/tribe/scripts/doctor.sh` — needs `bun`, `gh` authenticated, a Claude Code login
(never `ANTHROPIC_API_KEY` alone), and the runner's dependencies installed. Chrome must be
installed at the path above for the two screenshots; if it is missing, they land in
`commands.md`'s "Screenshot failure" section instead of silently vanishing.
