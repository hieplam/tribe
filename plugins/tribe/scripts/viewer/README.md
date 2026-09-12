# Campaign viewer

A **stateless, read-only** local HTTP server for a machine's `~/.tribe/` tree, with two surfaces:

- **Status page** (`GET /`) — a refresh-based snapshot of every campaign found under
  `--tribe-root`: liveness, cards, escalations, worker reports, the session log tail. Every GET
  re-scans from scratch; the refresh IS the poll, nothing is cached (unchanged from before this
  package grew a second surface).
- **Live view** (`GET /live`) — while a campaign's session is running, one page listing every
  process the runner spawned for the currently running card (the executor session and every
  subagent) and tailing each transcript live, over Server-Sent Events, within ~2s of a new
  message. See
  [`docs/superpowers/specs/2026-09-02-campaign-live-viewer-design.md`](../../../../docs/superpowers/specs/2026-09-02-campaign-live-viewer-design.md)
  for the full design.

This file documents what the code in this directory **actually does** — verified against the
code, not asserted from memory.

## Read-only, by construction

Nothing in this package ever writes, renames, deletes, locks, or executes anything, anywhere; it
never calls `git`, `gh`, or any network endpoint; it binds `127.0.0.1` only. Every filesystem
access — for both surfaces — goes through `adapters/scan.adapter.ts` (status page) or
`adapters/transcript.adapter.ts` (live view); the poller
(`adapters/poller.adapter.ts`) is the only clock owner. Nothing under `core/` touches the
filesystem, the clock, or the network directly — `structure.test.ts` enforces this mechanically
on every `bun test` run.

## Run it

```sh
bun serve.ts --tribe-root ~/.tribe --port 4321
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--tribe-root` | `$HOME/.tribe` | Root directory to scan for `<repoKey>/campaigns/<slug>/` trees. |
| `--port` | `4321` | HTTP port, bound to `127.0.0.1` only. |

## Routes

| Route | Response |
| --- | --- |
| `GET /` | The status page (unchanged renderer), plus one "watch live" link per campaign section. |
| `GET /live?repo=<repoKey>&slug=<slug>[&process=<id>]` | The live page shell — content arrives over `/events`. |
| `GET /events?repo=…&slug=…[&process=…]` | SSE stream: `processes`, `snapshot`, `append`, `ping`, `error`. Capped at 8 concurrent streams; the 9th connection gets `503`. |
| `GET /api/processes?repo=…&slug=…` | `{ processes }` JSON — the machine-readable process list (also the e2e's assertion surface). |
| `GET /app.js`, `GET /app.css` | The two static browser client files, served from memory from a fixed allowlist — never resolved from the request path. |
| `GET /healthz` | `{ ok: true, viewer: "tribe-live-viewer", v: 1 }` — the runner's "is a viewer already serving this port" reuse probe. |
| anything else | `404` |

`repo` and `slug` are separate query parameters (never one slash-joined value) and must each
match `^[A-Za-z0-9._-]+$`; anything else is `400` before a single path is built.

An `/events` connection sends a `ping` frame every 15s (`PING_INTERVAL_MS`,
`adapters/poller.adapter.ts`) to keep it alive across quiet periods. `Bun.serve()` is started
with `idleTimeout: SSE_IDLE_TIMEOUT_SECONDS` (`core/live/model.ts`, currently 60s) — comfortably
above the ping interval — so Bun's own connection-idle timeout never races the keepalive and
closes a quiet stream first (F55).

## How the live view finds a campaign's transcripts

Given `repo` + `slug` alone (no new persisted field — nothing under `~/.tribe` gained a new
field for this feature):

1. Read the campaign's newest `runs/<id>/run.json` for the target repo's `cwd` and the
   `campaign-state.json` path.
2. Read that state file's `sequence`/`cards`; pick the newest-in-sequence card whose status is
   `running` (falling back to the last card in `sequence` if none is currently running, e.g. the
   run already ended) — that card's `sessionId` names the session to watch.
3. Encode the repo `cwd` the same way Claude Code does
   (`core/live/paths.ts:sanitizeProjectDirName`, ported from Kanna) to find
   `~/.claude/projects/<encoded>/<sessionId>.jsonl` (the parent transcript) and
   `~/.claude/projects/<encoded>/<sessionId>/subagents/agent-*.jsonl` (+ `.meta.json` sidecars,
   for every subagent).

## Package layout

The consolidation collapses the two former surfaces into one package (spec §3.1). Every module
under `core/` is PURE — no filesystem, clock, env, or network — and reaches the outside world only
through the abstractions the three `adapters/` construct; `serve.ts` is the composition root that
wires them (`pure-core.md`). The `core/live/` tree of the pre-consolidation viewer is gone: its
contract, path math, tail state machine, records/markdown/normalize parsing, process derivation,
and routes now live as the peer `core/` modules named below.

```
serve.ts                 composition root: routes + wiring
core/                    PURE — no fs, no clock, no env, no network
  model.ts               the wire contract: RenderNode, MdToken, SessionSummary, Frame, Route
  paths.ts               cwd encoding, containment, fixed-layout joins
  window.ts              complete-line selection over supplied raw bytes; findWindow backward reader
  tail.ts                pure tail transition: offset, ackOffset, carry, inode reset
  records.ts             tolerant JSONL row parse
  markdown.ts            markdown -> MdToken[]
  normalize.ts           rows -> RenderNode[] (spec §7 is its contract)
  pair.ts                single forward pass tool_use/tool_result
  title.ts               title selection (spec §5.3)
  liveness.ts            live = grew or mtime within 10 min
  subagents.ts           sidecar tree (from the former core/live/processes.ts)
  badge.ts               badge derivation + campaign selection/cap (pure over already-read JSON)
  routes.ts              URL -> Route (spec §3.2)
  sse.ts                 frame encode/decode, sequence ids, 1 MiB frame batching
adapters/                the only impure edges — thin, fail-closed
  fs.adapter.ts          every transcript read (stat, readdir, ranged read, realpath)
  campaign.adapter.ts    the ONLY two ~/.tribe reads + the pid liveness probe
  poller.adapter.ts      the only clock owner: one poll loop per SSE stream
client/                  the browser SPA (React + Vite; built to dist/)
fixtures/build.ts        builds a whole ~/.claude/projects tree FROM NOTHING (spec §16.2)
tools/                   one-off corpus measurement scripts; NOT core, never in a request path
structure.test.ts        the executable purity + safety wall for this package
e2e/                     opt-in, real end-to-end proofs (spec §14) — see e2e/README.md
```

Some `core/` and `adapters/` modules of the target tree land in the consolidation's later phases;
until then the pre-consolidation `serve.ts`, `core/derive.ts`, `core/render.ts`, and the
`scan.adapter.ts`/`transcript.adapter.ts`/`poller.adapter.ts` trio remain in the tree, PENDING
DELETION, and their broken imports are the only red in the suite (they are removed in phases 2–4).

Check command: `bun run check` (`tsc --noEmit && bun test`).

## Opt-in end-to-end proof

`e2e/` proves the whole picture — a real campaign run through the real runner, watched through
this viewer — with a real (billed) Claude session. It never runs as part of `bun test`; see
[`e2e/README.md`](e2e/README.md) for the opt-in gate, cost, and what it writes.

---

## Viewer consolidation (`docs/tribe/planning/viewer-consolidation/spec.md`)

The sections above describe the pre-consolidation, two-surface package. They are being replaced,
in place, by the sections below as the consolidation plan's later tasks land — see
`.c3/adr/adr-20260911-viewer-consolidation.md` for the decision record. Do not delete the
sections above until the section replacing them is filled in.

### Routes

_Filled in by Task 21 (the route table of spec §3.2)._

### On-disk discovery

_Filled in by Task 21 (the discovery algorithm of spec §5)._

### Tail and the SSE contract

_Filled in by Task 21 (spec §6)._

### Build step

_Filled in by Task 21 (spec §10.3); refined by Task 26 once `install.sh` and `doctor.sh` build
the client._

### Failure modes

_Filled in by Task 21 (the fail-closed table of spec §13)._
