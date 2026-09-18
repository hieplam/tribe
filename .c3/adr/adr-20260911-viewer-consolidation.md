---
id: adr-20260911-viewer-consolidation
c3-seal: 0c5e234eb14b3c29f1560b31492fbc5adc765098859def0cbd0cb093da6b9552
title: viewer-consolidation
type: adr
goal: |-
    Consolidate the campaign viewer onto **Option A** (spec §1): one local server over
    `~/.claude/projects` — the folder where Claude Code writes every session transcript — instead of
    the current two-surface design (a `~/.tribe`-scanning status page and a separate runner-log
    `/live` tail). The new viewer lists every session on the machine, renders any one of them, and
    follows the ones still being written; campaign facts appear only as a small badge read from
    exactly two files under `~/.tribe` (`campaign-state.json`, `run.json`). Retiring the second
    surface removes ~3,200 of the package's 6,076 lines (spec §11.1) and the state-file
    path-traversal defect (B3) that surface carried.
status: accepted
date: "2026-09-11"
supersedes:
    - adr-20260903-fix-viewer-launch-docs
---

## Goal

Consolidate the campaign viewer onto **Option A** (spec §1): one local server over
`~/.claude/projects` — the folder where Claude Code writes every session transcript — instead of
the current two-surface design (a `~/.tribe`-scanning status page and a separate runner-log
`/live` tail). The new viewer lists every session on the machine, renders any one of them, and
follows the ones still being written; campaign facts appear only as a small badge read from
exactly two files under `~/.tribe` (`campaign-state.json`, `run.json`). Retiring the second
surface removes ~3,200 of the package's 6,076 lines (spec §11.1) and the state-file
path-traversal defect (B3) that surface carried.

## Context

**The oracle (spec §0), quoted:** "The Claude Code transcript files on this machine are the
oracle. Kanna's code is a reference, never the standard. Under-rendering (a row type or content
block present on disk that the viewer drops silently) is a bug. Over-rendering (showing a
raw-JSON fallback card for an unknown row) is by design. File order is the display order — never
sort by timestamp." That single scan (2026-09-12, Claude Code 2.1.267) measured **127,085 rows
parsed** across the whole corpus with **0 rows that failed `JSON.parse`** — the transcript format
is reliable enough to be the sole source of truth, which is what makes deleting the second
surface safe rather than merely convenient.

**Why the second surface is redundant, measured (`references/runner-log-vs-transcript.md`):** the
runner's per-session log and the Claude transcript render the same underlying conversation twice.
A byte breakdown of one measured card showed **83.6% of the runner log is a verbatim duplicate of
the transcript + its sidecars**; the log carries nothing a viewer needs that the transcript lacks
(`resetsAt` and the `result` row are watchdog-only, never rendered). The status page's "Session
tail" panel and the runner-log reader (`adapters/scan.adapter.ts`) are therefore pure duplication
cost with no rendering benefit, and D6 ("The viewer reads the Claude transcript ONLY... the viewer
never reads it \[the runner log]") retires that reader outright (spec §11.1).

**Why the transcript-only design is also a correctness fix, not just a simplification** — three
defects of the pre-consolidation viewer (`references/tribe-viewer-research.md`), all closed by
this consolidation:

- **B1** — tool results already on disk at connect time were dropped; the new tail contract
(spec §6.0) shows tool calls with their results, including a result that arrives later.
- **B2** — array-form user prompts were dropped, so every runner prompt was invisible; the
normalizer's coverage table (spec §7) renders every content block, string or array.
- **B3** — a state-file path was joined without containment, a path-traversal defect; the new
containment root is the resolved `~/.claude/projects` directory for every read (D14, spec
§12.2), enforced before any path is joined.

## Decision

Adopt Option A as specified in `docs/tribe/planning/viewer-consolidation/spec.md` §3
(Architecture): three layers, one process — two world-touching adapters
(`adapters/fs.adapter.ts` for the transcript, `adapters/campaign.adapter.ts` for the two
`~/.tribe` badge files), a pure core that decides everything and touches nothing
(`structure.test.ts` enforces this mechanically), and `serve.ts` as the single composition root.
The status page, `/live`, `/app.js`, `/app.css` and `/api/processes` are deleted outright (spec
§11.1); `core/live/tail.ts`, `core/live/records.ts`, `core/live/markdown.ts`,
`core/live/processes.ts`, `core/live/paths.ts`, `core/live/routes.ts` and
`core/live/normalize.ts` are rewritten in place onto the new wire contract (spec §11.2, §4).

## Consequences

This decision requires two change units against `.c3/c3-2-plugins/c3-215-tribe.md`, both applied
**in the same PR as the code that makes them true** (`rule-change-unit-ships-with-code`), never
here:

- **c3-215 row 76** (the viewer's Contract row, `plugins/tribe/scripts/viewer/serve.ts`) —
rewritten wholesale to describe the single-surface route table of spec §3.2 in place of the
two-surface `--tribe-root` description. Landed by plan task 21, as
`.c3/changes/adr-20260911-viewer-consolidation/01-c3-215-contract-viewer-row.patch.md`.
- **c3-215 row 72** (the runner's Contract row, `plugins/tribe/scripts/runner/run.ts`) — the
viewer-facing sentences updated to the new printed-URL shape and the `/healthz` v2 identity
change (spec §10.4). Landed by plan task 29, as
`.c3/changes/adr-20260911-viewer-consolidation/02-c3-215-contract-runner-row.patch.md`.

Both rows must escape every literal `|` inside the table cell as `\|` (`rule-c3-table-cell-no-pipe`).
Until both change units land, `c3-215` describes a viewer and a runner-viewer integration that no
longer exist; this ADR is the record that the gap is scheduled, not open-ended.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-215 | component | Row 76 (viewer Contract) and row 72 (runner Contract) both describe the pre-consolidation two-surface design and must be replaced by the change units named in Consequences | Doc-only Contract corrections landed by tasks 21 and 29; no topology or boundary change to c3-215 itself |

## Verification

| Check | Result |
| --- | --- |
| bunx @c3x/cli@11.6.3 check </dev/null | Clean before and after this ADR (recorded in the task report) |
| .c3/changes/adr-20260911-viewer-consolidation/01-c3-215-contract-viewer-row.patch.md applies to c3-215 row 76 | Deferred to plan task 21 |
| .c3/changes/adr-20260911-viewer-consolidation/02-c3-215-contract-runner-row.patch.md applies to c3-215 row 72 | Deferred to plan task 29 |
