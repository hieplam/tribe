# Campaign viewer

A **stateless, read-only** local HTTP server, **one surface**: every Claude Code session
transcript on the machine (`~/.claude/projects/`), listed, rendered, and followed live. Campaign
facts are a small badge read from exactly two files under `~/.tribe` — never a second surface, and
never a store (D7).

This file documents what the code in this directory **actually does** — verified against the
code, not asserted from memory. It is written against
[`docs/tribe/planning/viewer-consolidation/spec.md`](../../../../docs/tribe/planning/viewer-consolidation/spec.md)
§3.2 (routes), §5 (discovery), §6 (the SSE contract), §10.3 (the build step) and §13 (the
fail-closed table); see the spec for the full rationale behind each rule below, and
[`.c3/adr/adr-20260911-viewer-consolidation.md`](../../../../.c3/adr/adr-20260911-viewer-consolidation.md)
for why the pre-consolidation two-surface design (a `~/.tribe`-scanning status page plus a
separate `/live` runner-log tail) was retired.

## Read-only, by construction

Nothing in this package ever writes, renames, deletes, locks, or executes anything, anywhere; it
never calls `git`, `gh`, or any network endpoint; it binds `127.0.0.1` unless the owner passes
`--host` (the `tribe --remote` flag) to open it to the local network. Every filesystem
access goes through one of two adapters — `adapters/fs.adapter.ts` (every transcript read: stat,
readdir, ranged read, realpath) or `adapters/campaign.adapter.ts` (the *only* two `~/.tribe` reads
— `campaign-state.json` and `run.json` — plus the pid liveness probe). `adapters/poller.adapter.ts`
is the only clock owner (one 250 ms poll loop per open `/events` stream). Nothing under `core/`
touches the filesystem, the clock, the network, or `process.env`/`process.argv` directly —
`structure.test.ts` enforces this mechanically on every `bun test` run.

## Run it

The everyday way is the `tribe` command ([`../cli/README.md`](../cli/README.md)): it picks a free
port, starts this server in the foreground, and opens the browser. Directly:

```sh
bun serve.ts --port 4321
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--port` | `4321` | HTTP port. `1-65535`; `--port abc`, `--port 0`, `--port 70000`, or an unknown flag each refuse with one stderr line and exit `2` (never a stack trace, never a random port). A port already in use refuses with one stderr line and exit `1`. |
| `--host` | `127.0.0.1` | Address to listen on. `0.0.0.0` (what `tribe --remote` passes) makes the viewer reachable from any device on the local network, with **no password** — kanna's `--remote` behaviour, chosen by the owner. The startup prints each `http://<LAN-IP>:<port>` URL and a no-password warning. A host that is not `0.0.0.0`, `localhost`/`127.0.0.1`, or one of this machine's own IPv4 addresses (IPv6 included) refuses with one stderr line and exit `2` before binding (Bun would otherwise misreport it as `EADDRINUSE`, i.e. "port in use"). A missing value refuses with exit `2`. |

`--tribe-root` is gone. Both roots the server needs are resolved from the environment alone, once
at boot, and printed on the startup line:

- **Projects root** (spec §5): `$CLAUDE_CONFIG_DIR/projects` when `CLAUDE_CONFIG_DIR` is set and
  non-empty, else `$HOME/.claude/projects`. An empty `CLAUDE_CONFIG_DIR=` is treated as unset. A
  **set but unreadable** `CLAUDE_CONFIG_DIR` (missing, not a directory, or `EACCES`) is a typed
  refusal at start — one stderr line, exit `2` — never a silent fall back to `~/.claude`, because
  that would hand a user who deliberately sandboxed their config someone else's sessions.
- **Tribe root**: `$HOME/.tribe`, for the two-file badge read described below.

`HOME` and `CLAUDE_CONFIG_DIR` are the only environment values this package reads, and only in
`serve.ts` — the composition root, and the only file that reads `process.env` or `process.argv`.

## Routes

One route table, two families: everything under `/api` and `/events` is JSON or SSE; everything
else that is not a built asset returns the SPA shell, so the React client owns the address bar.

| Method + path | Response | Notes |
| --- | --- | --- |
| `GET /` | `dist/index.html` | list view; `?campaign=<repoKey>/<slug>` pre-fills the filter (the pair, never the slug alone); `?all=1` shows projects older than the 30-day window |
| `GET /p/<encodedProjectDir>` | `dist/index.html` | one project |
| `GET /s/<sessionId>` | `dist/index.html` | one session; project resolved by scanning, never by joining the id into a path |
| `GET /s/<sessionId>/a/<agentId>` | `dist/index.html` | one subagent tab |
| `GET /index.html` | `dist/index.html` | the same bytes as `GET /` |
| `GET /assets/<name>` | the built file | a fixed allowlist read from `dist/` into memory once at boot — never a path join at request time |
| `GET /healthz` | `{"ok":true,"viewer":"tribe-viewer","v":2}` | **deliberately not** the pre-consolidation `{"ok":true,"viewer":"tribe-live-viewer","v":1}` body — an already-running old viewer must be unrecognisable to the runner's reuse probe |
| `GET /api/projects?all=1` | `{"projects":[...],"olderCount":n,"skippedBadges":n}` | without `all=1`, `projects` is the 30-day window and `olderCount` is the remainder |
| `GET /api/sessions?project=<dir>` | `{"project":...,"sessions":[...]}` | |
| `GET /api/session/<sessionId>` | `{"session":...,"subagents":[...],"badges":[...]}` | metadata only — rows never come from here, only from `/events` or `/api/rows` |
| `GET /api/rows?session=&agent=&before=&limit=&orphans=` | `{"nodes":[...],"patches":[...],"from":n,"to":n,"truncatedBefore":bool}` | see below |
| `GET /api/block?session=&agent=&at=&i=` | `{"block":...}` | one elided payload addressed by row byte offset + block index |
| `GET /api/spill?session=&name=` | `text/plain` | a persisted-output file, name- and containment-checked |
| `GET /events?session=&agent=` | `text/event-stream` | see "Tail and the SSE contract" below |
| anything else | see the one rule below | never a stack trace |

**`/api/rows` in full.** `before` is a **row byte offset** — pass back the `from` you currently
hold and the response is exactly the window immediately preceding it; omitted, it returns the tail
window (the same backward algorithm `hello` runs). `orphans` is a comma-separated list of
`tool_use_id`s the client currently holds without a result; for each one whose call lies in the
returned range, the response carries a `Patch`. `limit` is the number of **pre-pairing candidate
nodes** to gather — default 500, maximum 2000, clamped rather than refused. The response's `from`
is the first retained row's byte offset (pass it back as the next `before`); `to` is one past the
last complete row, never `EOF`; `truncatedBefore` says whether any row precedes `from`.

**The one rule for a path not in the table above:** a path that is client-routed — `/`,
`/index.html`, or anything under `/p/` or `/s/` — returns the SPA shell with `200`, because the
React router owns those addresses and the server cannot know which of them is meaningful.
Everything else returns `404` with a JSON body `{"error":"not found","path":"<path>"}`. So
`/s/does-not-exist` returns the shell (the client renders "no session with that id") while
`/api/session/does-not-exist` returns a `404` — the split is by prefix, not by existence, which is
also what keeps the routing layer free of a traversal surface: the server never probes the
filesystem to decide a status code.

Every `sessionId`/`agentId`/`project` value is validated and contained **before any path is
joined** — both lexically and, after `realpath`, against the resolved projects root (a symlinked
`subagents` directory, sidecar, or spill that escapes the root, or a symlink loop, is refused, not
read). Every request is also gated on `Host`/`Origin`, `403` otherwise (DNS-rebinding defense,
`core/net.ts#hostHeaderAllowed`): on the default loopback bind only `127.0.0.1[:port]` or
`localhost[:port]`; on a network bind (`--host`) also any IPv4 literal and any `*.local` name —
how another device addresses this machine — while a request under any other DNS name is still
refused, because that is the shape a rebinding attack needs. Every response carries
`X-Content-Type-Options: nosniff`; the HTML document responses (the SPA shell) additionally carry a
Content-Security-Policy.

## On-disk discovery

Given the resolved projects root, `serve.ts` walks it two levels deep and never any deeper — no
path component is ever taken from a file's contents, a query parameter, or a JSON field:

1. `readdir(projectsRoot)` → candidate project directory names; skip anything that is not a
   directory.
2. For each project directory: `readdir` it. Every `*.jsonl` is a session id (the basename minus
   `.jsonl`); every `<sessionId>/` directory is that session's sidecar home.
3. For each session: `stat` for size/mtime; a **head read** (first 64 KiB) and a **tail read**
   (last 256 KiB) — never the whole file — for its title and `cwd`; `readdir` its
   `subagents/` directory, keeping entries matching `^agent-(.+)\.jsonl$`, for its subagent count
   and (per match) the sibling `agent-<id>.meta.json`.
4. A project's `cwd` is the first non-null `cwd` field seen across its sessions' head reads.

**Title rule**, in order: last `custom-title`, else last `ai-title`, else `last-prompt`, else the
first user message, else the session id.

**Ordering** is display ordering of files, not of rows: projects by `newestMtimeIso` descending,
sessions within a project by `mtimeIso` descending. Rows inside a transcript are always shown in
file order, never timestamp order.

**Resolving `/s/<sessionId>` without a project in the URL:** the id is validated
(`^[0-9a-fA-F-]{8,64}$`, no dots, no separators) and then never joined — the scan index is asked
for a session with that id, and the caller uses the `projectDir` the scan itself produced from
`readdir`. Two sessions with the same id in two project dirs resolve to the newest by mtime, and
the response carries every encoded project directory that holds the id.

**Liveness**: `live = (sizeBytes grew since the previous scan) || (now - mtime <= 10 min)`. No pid,
no campaign state, no lock file.

**The default project window**: the sidebar shows by default only projects whose newest session is
within 30 days; `?all=1` reveals the rest. Sessions inside a shown project are never hidden by this
window, and a session named by a campaign badge is reachable by its own URL regardless of its
project's age.

**The session read cache** is keyed on `path + sizeBytes + mtimeMs + inode`, bounded to 500
entries, LRU — a miss is always a correct re-read, so this holds derived summaries only and does
not violate the "no store" rule.

**Campaign badges**: `adapters/campaign.adapter.ts` is the *only* code that reads `~/.tribe`, and
it reads exactly two files per campaign — `campaign-state.json` and `run.json` — never a third. A
malformed or unreadable state file degrades that campaign's badges to `[]`, per-campaign fault
isolated; other campaigns are unaffected. `~/.tribe` missing entirely degrades every session's
`badges` to `[]` (never `null`). A `sessionId` in a state file that is not a valid id is dropped
from the index and counted in `skippedBadges`.

## Tail and the SSE contract

`GET /events?session=<sessionId>[&agent=<agentId>]` opens one stream for one **focused**
transcript view — the parent session, or one subagent tab. Switching tabs navigates to a new URL,
which closes the old `EventSource` and opens a new one. Capped at **8 concurrent streams**; a 9th
connection gets `503 too many live streams`.

| `event:` | `data` | Emitted |
| --- | --- | --- |
| `hello` | `{"generation":...,"session":...,"agents":[...],"badges":[...],"from":n,"to":n,"truncatedBefore":bool}` | once, on connect; `generation` is new per connection |
| `rows` | `{"nodes":[...],"from":n,"to":n}` | the initial window, then on every growth tick — append-only |
| `patch` | `{"patches":[...]}` | a later-arriving fact about a node already sent (e.g. a tool result whose call was sent earlier) |
| `meta` | `{"agents":[...],"badges":[...],"live":bool}` | whenever the agent set, badges, or liveness change — including a new sidecar appearing mid-stream |
| `reset` | `{"reason":"truncated"\|"rotated"}` | the file was truncated or replaced; the server then streams the normal tail window, never the file from byte 0 |
| `ping` | `{"t":"<iso>"}` | every 15 s |
| `gone` | `{"reason":"deleted"}` | the focused file disappeared; the client stops retrying |

**`id:` is a per-stream monotonic sequence number**, starting at 1 on `hello` and incrementing by
one per frame of any type — the client's rule is to ignore a frame whose `id` it has already
processed. The server never reads `Last-Event-ID`: a reconnect is treated as a brand-new client,
with a **new `generation`**, a fresh snapshot read from the file as it now is, and pairing state
rebuilt by a forward pass over that snapshot. Nothing is "resumed". A client whose `generation`
changes clears its store before applying the new snapshot; dedupe by row id only ever applies
within one generation.

**On connect, the window is the last 500 nodes** — `core/window.ts#findWindow`, a pure function
with the read injected, walks the file *backwards*, one row at a time by newline search, until it
has gathered at least 500 pre-pairing candidate nodes or reached the start of the file. The window
always ends at the last **complete** row (never mid-row, since a live file is very often cut
mid-write); the trailing partial bytes become the forward tail's initial carry. The same function
serves `/api/rows`' back-fill — one algorithm, two entry points.

**The row cap is 8 MiB (`ROW_CAP`)**, the same constant in both the forward tail
(`core/tail.ts#advanceTail`) and the backward window reader — a row of *exactly* `ROW_CAP` bytes is
valid and parses; only a strictly longer one is oversized. An oversized row is skipped to its next
newline and rendered as exactly one `raw` node ("row too large (`N` bytes)"), anchored at the
row's own true start; the row after it parses normally.

**Poll interval**: 250 ms, capped at reading 4 MiB per tick — the remainder arrives next tick, and
no byte is skipped or double-counted, because the tail's offset advances only by bytes actually
consumed (never `fileSize`, never a decoded character count). **Frame size** is bounded at 1 MiB:
`core/sse.ts#batchFrames` splits a tick's nodes across as many `rows` frames as needed, each with
its own `id:`.

## Package layout

Three layers, one process (spec §3). Every module under `core/` is PURE — no filesystem, clock,
env, or network — and reaches the outside world only through the abstractions the two adapters
construct; `serve.ts` is the composition root that wires them (`pure-core.md`).

```
serve.ts                 composition root: argument parsing, Host/Origin gate, dist/ allowlist,
                          route dispatch, fail-closed startup
core/                    PURE — no fs, no clock, no env, no network
  model.ts               the wire contract: RenderNode, MdToken, SessionSummary, Frame, Route
  paths.ts               cwd encoding, containment, fixed-layout joins
  window.ts              complete-line selection over supplied raw bytes; findWindow, the
                          backward reader, pure, with the read injected
  cache.ts               pure cache/eviction policy over a supplied clock reading
  scan.ts                the project/session index + the 30-day partition
  tail.ts                pure tail transition: offset, ackOffset, carry, inode reset
  records.ts             tolerant JSONL row parse
  markdown.ts            markdown -> MdToken[] (a token tree, never an HTML string)
  normalize.ts           rows -> RenderNode[]
  pair.ts                single forward pass tool_use/tool_result
  title.ts               title selection
  liveness.ts            live = grew or mtime within 10 min
  subagents.ts           sidecar tree
  badge.ts               badge derivation + campaign selection/cap (pure over already-read JSON)
  routes.ts              URL -> Route
  sse.ts                 frame encode/decode, sequence ids, 1 MiB frame batching
  net.ts                 --host validation, the Host/Origin allow rule, LAN address list
adapters/                the only impure edges — thin, fail-closed
  fs.adapter.ts          every transcript read (stat, readdir, ranged read, realpath)
  campaign.adapter.ts    the ONLY two ~/.tribe reads + the pid liveness probe
  poller.adapter.ts      the only clock owner: one poll loop per SSE stream
client/                  the browser SPA source; the served bundle lives in dist/ (see "Build step")
fixtures/build.ts        builds a whole ~/.claude/projects tree FROM NOTHING
tools/                   one-off corpus measurement scripts; NOT core, never in a request path
structure.test.ts        the executable purity + safety wall for this package
e2e/                     opt-in, real end-to-end proofs — see e2e/README.md
```

`core/derive.ts`, `core/render.ts` and `client/app.js`/`client/app.css`/`client/app.test.ts` are
the pre-consolidation status-page/live-view modules: no longer imported by `serve.ts`, and pending
outright deletion by later tasks in the consolidation plan (they are not part of this package's
current request path).

Check commands:

- `bun run check` (`tsc --noEmit && bun test`) — the server/root typecheck plus the whole test
  suite. Its `tsc` uses the root `tsconfig.json`, whose `include` **excludes `client/src/`** (the
  browser code needs the DOM lib and JSX the root config does not carry), so `bun run check` does
  **not** type-check the client. Its root typecheck still reports the pre-consolidation legacy
  modules (`core/derive*`, `core/render*`, `e2e/harness*`) until they are deleted by later
  consolidation tasks.
- `bun run check:client` (`tsc -p tsconfig.client.json --noEmit`) — the **client typecheck gate**:
  type-checks every `.ts`/`.tsx` under `client/src/**` (tests included) with the DOM lib, JSX, and
  `bun` types. Run this alongside `bun run check` to cover the React client.

## Build step

`serve.ts` serves whatever static bundle sits in `dist/` — it reads `dist/` once at boot into an
in-memory allowlist, with no `--dist` override flag. `dist/` is **git-ignored** (committing a build
artifact into a symlink-installed plugin would make every client change a binary-ish diff) and is
produced by a build step, not checked in. The client toolchain under `client/` (React 19 + Vite) and
the build script that emits `dist/` are landed by a later task in the consolidation plan (task 26);
this phase serves the `dist/` bundle as it stands without asserting how it was built.

`serve.ts` fails closed when `dist/index.html` is absent: one stderr line —

```
viewer: client not built — run ./install.sh (or: cd plugins/tribe/scripts/viewer && bun run build)
```

— and exit code `2`. Never a blank page, never a stack trace. The plugin-level install hook
(`plugins/tribe/install.sh`) runs the build (`bun install --frozen-lockfile && bun run build`) as
part of a normal install, warning and continuing — never failing the whole install, which also
links agents/rules/canvases and must keep working on a machine with no bun — if the build itself
fails or `bun` is absent from `PATH`; `plugins/tribe/scripts/doctor.sh` reports
`viewer client built (dist/index.html)` or names the exact fix if it is missing. On a machine
with no bun (or before the hook has ever run), `dist/` can still be built by hand:
`bun install && bun run build` in this directory, then `bun serve.ts`.

## Look and feel

The client is styled to the owner-ratified sea-salt design
(`docs/tribe/planning/viewer-consolidation/design/sea-salt/preview.html`, screens §C list and §D
session). Dark mode is free: `tokens.css` re-declares the same custom properties under
`prefers-color-scheme: dark`, so there is no toggle and no second stylesheet.

- **Tokens source** — `docs/tribe/planning/viewer-consolidation/design/sea-salt/tokens.css`,
  imported once by `client/src/styles/index.css` and never copied, is the only place a colour,
  font, size, space, radius or shadow is spelled. `list.css` (session-list screen) and
  `session.css` (session view) read them as `var(--token)`; `structure.test.ts` bans any hex / `rgb(` / `hsl(` / `oklch(`
  literal, non-token `font-family:` and bare `Npx` length anywhere under `client/`.
- **Ratchet** — `bun tools/unstyled-classes.ts` lists every class the components use that no
  stylesheet rule mentions; `tools/unstyled-classes.ratchet.test.ts` holds the committed ceiling
  (`UNSTYLED_CEILING = 0`). A new class must ship with a rule; the ceiling only ever moves down.
- **Visual contract** — `e2e/visual-contract.e2e.test.ts` drives real Chromium against the real
  server and asserts the *computed* styles of both screens against the resolved token values, in
  light and again under `colorScheme: 'dark'`. It runs with the normal `bun test`.
- **Capture** — `bun run build`, then
  `bun e2e/visual-parity.ts --out <dir> [--label before|after]` writes side-by-side screenshots
  (live app | preview reference, light and dark) and an `index.html` to compare them. The committed
  before/after sets live in `docs/tribe/planning/viewer-visual-parity/evidence/`.

## Opt-in end-to-end proof

`e2e/` proves the whole picture — a real campaign run through the real runner, watched through
this viewer — with a real (billed) Claude session. It never runs as part of `bun test`; see
[`e2e/README.md`](e2e/README.md) for the opt-in gate, cost, and what it writes.

## Failure modes

Every row is what the user sees; no row is a stack trace. Every one of these is a named case in
`serve.security.test.ts`, `serve.api.test.ts`, `serve.reads.test.ts`, `serve.events.test.ts`,
`core/*.test.ts`, or `adapters/*.test.ts`.

| Input / condition | Behaviour |
| --- | --- |
| `--port abc`, `--port 0`, `--port 70000` | one stderr line `viewer: --port expects an integer 1-65535, got "abc"`, exit 2 |
| unknown flag | one stderr line naming it, exit 2 |
| port already in use | one stderr line `viewer: port 4321 is already in use`, exit 1 |
| `dist/index.html` missing | one stderr line + exit 2 (see "Build step" above) |
| the projects root is missing or unreadable | the scan degrades to an empty project list — never a crash; the resolved root is printed on the startup line |
| `CLAUDE_CONFIG_DIR` set to a path that does not exist, is not a directory, or cannot be read | typed refusal at start: one stderr line, exit 2 — never a silent fall back to `~/.claude` |
| `CLAUDE_CONFIG_DIR=` (set but empty) | treated as unset; the root is `~/.claude/projects` |
| `~/.tribe` missing entirely | every session's `badges` is `[]` (never `null`); nothing else changes |
| `campaign-state.json` malformed or wrong shape | that campaign contributes no badges; other campaigns unaffected |
| `run.json` malformed | `runnerAlive: false`, `runId: null` |
| a `sessionId` in a state file is not a valid id | dropped from the index; counted in `skippedBadges` |
| a transcript line fails `JSON.parse`, or is a JSON array or bare scalar | counted; the window emits one `unreadable` node; never a throw |
| transcript deleted while streamed | `gone` frame, stream closed, client stops retrying |
| transcript truncated or replaced while streamed | `reset` frame, then the normal tail window — never byte 0 |
| transcript truncated or replaced while disconnected | nothing special: a reconnect is a fresh snapshot under a new `generation` |
| a single row exceeds `ROW_CAP` (8 MiB) | one `raw` node, `rowType: "oversized"`, the rest of the row skipped to the next newline |
| `/api/spill` name fails the charset check | `400 spill name refused: unsafe shape` |
| `/api/spill` name is shaped fine but fails containment (lexically, or the resolved path escapes the root) | `400 spill name refused` (R8) |
| `/api/spill` name is contained but the file is absent | `404 spill not found` |
| `/api/block` names an `at`/`i` that does not resolve to a block | `404` |
| 9th concurrent SSE stream | `503 too many live streams` |
| `Host`/`Origin` mismatch | `403` |
| a path is not in the route table | the SPA shell for `/`, `/index.html`, `/p/*` and `/s/*`; JSON `404` for everything else |
| `process.kill(pid, 0)` throws `EPERM` | `runnerAlive: true` (alive, not ours) |
| a spill/preview/session/asset path escapes its root lexically | refused before anything is opened |
| the path is lexically fine but resolves outside `~/.claude/projects` (a symlink) | refused |
| a symlink resolves to a sibling session inside the projects root | served — a real shape Claude Code writes |
| a project directory is a symlink pointing outside the root | refused during discovery, before any file in it is opened |
| a state file is unreadable (`EACCES`, `ENOENT`) | degrades to `null`, reported as absent, never as malformed |
| the browser sends `Last-Event-ID` on reconnect | ignored by the server; the client gets a fresh snapshot |
| a `patch` names a row id the client has evicted | dropped silently; not an error |
| a v1 (pre-consolidation) viewer holds the port | the runner prints one stale-viewer stderr line and does not spawn (its own README, not this one) |
