# Campaign live viewer — every spawned process, transcript tailed live — design

> **Superseded 2026-09-11.** The two-surface design this page describes (a `~/.tribe`-scanning
> status page plus this `/live` transcript tailer) is replaced by Option A — one surface over
> `~/.claude/projects` — in `docs/tribe/planning/viewer-consolidation/spec.md` and recorded in
> `.c3/adr/adr-20260911-viewer-consolidation.md`. This page is kept, not deleted: it is the
> record of what the deleted code (`core/live/**`, the status page, `/live`, the vanilla client)
> was for.

**Date:** 2026-09-02 · **Card:** `campaign-live-viewer` · **Status:** authored by the Warchief for Shaman review
**Will be committed at:** `docs/superpowers/specs/2026-09-02-campaign-live-viewer-design.md`
**Plan:** `docs/superpowers/plans/2026-09-02-campaign-live-viewer.md`

> The idea card is settled law. This spec answers **How** only; every What/Why below is quoted
> from the card, never re-decided. Card rulings are cited as **card D1–D7**; this spec's own
> design decisions are **D1–D14** and are cited by id from the plan.

---

## 1. Problem (grounded — every claim cites code verified on 2026-09-02)

The campaign runner is deliberately silent. Its loop prints one line per finished card
(`cli/main.ts:465-467` prints one `[cardId] outcome` line per processed card), while everything
interesting happens inside a headless Claude Code session it spawns through the Agent SDK
(`adapters/session.adapter.ts:5-13`). The owner is blind for the hour that session runs.

What already exists, and what it is missing:

- **The session id is captured and persisted.** On the SDK `system/init` message the runner
  writes `cards[<id>].sessionId` into `campaign-state.json` before anything else
  (`core/session.ts:238-277`, `core/loop/card-actions.ts:479-485`). Verified live:
  `~/.tribe/-Users-hip-repo-wiki-harness/campaigns/wiki-harness-extraction/campaign-state.json`
  carries 14 cards, each with a real session id.
- **`run.json` records everything needed to locate the rest** (`core/run-record.ts:7-25`):
  `repo` (the session's `cwd`, `core/session.ts:171-202`), `statePath`, `logsDir`, `pid`,
  `startedAt`, `endedAt`. Verified live in the same campaign's newest run dir.
- **The runner `.log` carries the parent stream only.** Every SDK message is appended as one
  JSON line (`core/session.ts:262-267`); a Hunter's or Skinner's own transcript never enters it.
- **Claude Code persists all of it anyway — including subagents.** Verified on this machine for
  a *runner-spawned* (SDK, `executable: 'bun'`) session:
  `~/.claude/projects/-Users-hip-repo-wiki-harness/6266ea2e-….jsonl` plus
  `~/.claude/projects/-Users-hip-repo-wiki-harness/6266ea2e-…/subagents/agent-<agentId>.jsonl`.
- **The existing status viewer is blind to all of it.** `scripts/viewer/serve.ts:9-27` re-scans
  on every GET and server-renders one HTML page with zero client JS; its "session tail" is the
  last 40 **raw JSON lines** of the runner `.log` in a `<pre>` (`adapters/scan.adapter.ts:252-280`,
  `core/render.ts:88-93`). No messages, no subagents, no live update. Its own spec
  (`docs/superpowers/specs/2026-07-24-tribe-status-viewer-design.md:38-46`) lists realtime push
  as a non-goal — **this card supersedes that one non-goal and keeps every other**, above all
  "no writes of any kind".
- **The only transcript path today is manual and unsafe:** `kanna/list-session-ids.sh` copies
  ids to the clipboard for Kanna's Import dialog; the runner README itself warns that sending
  from Kanna takes over the session and conflicts with the runner's resume
  (`scripts/runner/README.md:177-182`).

### 1.1 Two discoveries that shape the design

Both were verified directly on disk and neither is documented in the card or the research notes:

1. **Every subagent file has a `.meta.json` sidecar.** `agent-<agentId>.meta.json` next to
   `agent-<agentId>.jsonl` contains exactly
   `{"agentType","description","toolUseId","parentAgentId"?,"spawnDepth"}` — e.g.
   `{"agentType":"tribe:hunter","description":"Implement T20 apply/dry-run split","toolUseId":"toolu_017z…","spawnDepth":1}`.
   This is the process list, already written by Claude Code, available **the moment the subagent
   starts** — no mining of the parent's `tool_result` sidecar, no waiting for completion.
   `spawnDepth: 1` carries no `parentAgentId` (its parent is the root session); deeper agents
   carry one, and **all levels live flat in the ONE `subagents/` directory of the root session**,
   so the tree is rebuilt from `parentAgentId` alone.
2. **`type: "system"` rows are genuinely absent** on this CLI version (card D7 confirmed: a
   726-line real transcript contains `assistant`, `user`, `attachment`, `queue-operation`,
   `last-prompt`, `ai-title`, `mode`, `pr-link` and nothing else), and the main transcript
   contains **zero `isSidechain: true` lines** — subagent content is exclusively in the sidecar
   files. Assistant records carry one content block each in practice, but arrays are handled.

---

## 2. Goals / non-goals

**Goals** (restating the card's G1–G5 as the acceptance contract):

- **G1** For the running card: the executor session AND every subagent spawned so far, each a
  named entry (agent type, status, start time), transcript rendered as messages — user prompts,
  assistant text as markdown, thinking collapsed, tool calls paired with their results. Never a
  raw JSON dump.
- **G2** A transcript line written to disk appears in the open browser within **2 s**; a subagent
  appearing mid-run enters the process list within **2 s**.
- **G3** The runner brings the viewer up and prints its URL on its own stdout before the first
  card's session spawns; the same viewer starts standalone against any campaign home.
- **G4** Strictly read-only: no filesystem writes, no messages into any session, no `git`/`gh`,
  no bind beyond `127.0.0.1`.
- **G5** Opt-in end-to-end evidence from a real `run.ts` run on Haiku.

**Non-goals** (the card's fence, verbatim in effect):

- No control surface of any kind — no send, STOP, re-trigger, or escalation answer.
- No auth, tunnel, remote access, multi-machine.
- No change to the Kanna repo; Kanna is a read-only architectural reference.
- The runner's per-session `.log` is neither replaced nor removed.
- No historical-run browsing beyond what the status page already shows.
- No virtualized lists, per-tool bespoke renderers, diff viewers, search, or Mermaid.
- `kanna/list-session-ids.sh` and its test are **not** deleted (owner's call, flagged separately).
- No second viewer package: one process, one port, one package.

---

## 3. Design decisions (this spec's own — cited by id from the plan)

| # | Question | Ruling | Why |
|---|---|---|---|
| **D1** | How does the viewer find a campaign's transcripts? | From the campaign's own `run.json` + state file only: `projectDir = <home>/.claude/projects/<encodeCwd(run.repo)>`; parent = `<projectDir>/<sessionId>.jsonl`; subagents = `<projectDir>/<sessionId>/subagents/`. `sessionId` comes from `cards[<id>].sessionId`. | Card D1. Every input is already recorded; nothing is guessed. Verified live against a real runner session. |
| **D2** | What if `encodeCwd` cannot resolve (repo moved/deleted)? | Two ordered fallbacks: (a) encode the raw `run.repo` string without `realpath`; (b) `readdir` of `~/.claude/projects/*` and match a file whose name is **exactly** `<sessionId>.jsonl`. Never newest-mtime, never a content read of a non-matching file. | Card D1 forbids mtime heuristics (Kanna's cross-session bleed). Exact-id matching stays inside the fence: reads remain keyed by the campaign's own recorded ids. |
| **D3** | How is the process list derived? | From the `subagents/` directory listing plus each file's `.meta.json` sidecar (§1.1). Tree via `parentAgentId`; root-level agents (`spawnDepth: 1`, no `parentAgentId`) hang off the session node. Missing/unreadable meta degrades to `agentType: null`, never a dropped entry. | The sidecar is authoritative, present at spawn time, and needs no parsing of the parent stream — which for `run_in_background` dispatches only ever says `async_launched`. |
| **D4** | How do live updates reach the browser? | **Server-Sent Events** over the same `Bun.serve` process (`text/event-stream`), one stream per open page. | Chosen over WebSocket and client polling: (1) SSE is **structurally one-directional** — the transport itself cannot carry a client→server message, so G4's read-only promise is enforced by the protocol rather than by discipline; a WebSocket would create exactly the writable channel the fence forbids and then oblige us to prove we never use it. (2) Zero dependencies, zero build step: plain HTTP plus the browser's built-in `EventSource`. (3) Reconnect/`Last-Event-ID` is built in; polling would hand-roll it and re-render the whole page each tick. Verified working under Bun 1.3.14 (streamed `ReadableStream` response consumed by `fetch` — this is also how the e2e asserts latency without a browser). |
| **D5** | How does the client render without a bundler? | Two files served verbatim by the same bun process — `client/app.js` (a hand-written ES module, no imports) and `client/app.css`. No npm client dependency, no vendored library, nothing compiled. | The fence allows client JS "if the same bun process serves it" and forbids a build step in the run path. Serving two static files satisfies both literally. A vendored markdown library would be both a supply-chain surface and a build-path dependency for a need D6 removes. |
| **D6** | Where does markdown become HTML? | In the **pure core**, server-side: `core/live/markdown.ts` renders a deliberately small subset (fenced code, inline code, bold, italic, headings, bullet/numbered lists, links, paragraphs) to already-escaped HTML; the client only inserts the received fragment. | Keeps the only security-sensitive logic (escaping) pure and unit-tested, keeps the client dumb (~150 lines), and keeps `client/app.js` free of a parser it could not be tested against without a browser. |
| **D7** | Is the client itself testable? | Yes: `client/app.js` exports `createLiveClient({ EventSource, document, location })` and only self-starts under `if (typeof document !== 'undefined')`. `bun test` imports it and drives it with fakes. | The pure-core rule applied to the browser layer: the client's decisions are pure over injected abstractions; the DOM and `EventSource` are the injected edges. |
| **D8** | Tailing mechanism | `stat`-size delta + positional read + partial-line carry-over, polled every **400 ms**. `core/live/tail.ts` holds the pure state machine (`advanceTail(state, chunk)`); the adapter only stats and reads bytes. A size **decrease** resets position to 0 (truncation/rotation) and re-emits from the top. | Card D2 (Kanna ADR `adr-20260607-pty-transcript-pure-poll`: kqueue coalesces appends and stalls under Bun on macOS). 400 ms leaves 5× headroom under the 2 s budget (card D3). |
| **D9** | Poller lifetime | One poller per open SSE connection, torn down on disconnect; concurrent streams capped at 8 (`503` beyond that). | Simplest correct shape; each tick is one `stat` on one file plus one `readdir`. A shared refcounted per-campaign poller is more machinery than two open tabs justify. |
| **D10** | What happens to the existing status page? | **Kept and linked.** `GET /` remains today's server-rendered status page — same code, same tests — gaining one "watch live" link per campaign. `/live` is the new surface and links back. | Card fence: "Exactly ONE viewer at the end… the existing status page content stays available." One package, one port, one process. |
| **D11** | How is the viewer started? | The **runner** starts it from its composition root (`cli/main.ts`), before `runLoop`, through a new `adapters/viewer-launch.adapter.ts`; the decision is a pure function in `core/viewer-launch.ts`. Two new optional flags: `--viewer-port` (default `4321`) and `--no-viewer`. Skipped entirely under `--dry-run`. | G3 requires the URL on **the runner's own stdout** before the first session spawns. `structure.test.ts` stays intact by construction: the spawn lives in an adapter, `cli/main.ts` only wires it, `core/viewer-launch.ts` contains no banned specifier. |
| **D12** | How can viewer failure never affect a run? | The child is spawned **detached**, `stdio: 'ignore'`, then `unref()`ed; the whole launch is wrapped so any failure prints one stderr line and the loop proceeds. Reuse first (card D6): `GET /healthz` — a plain read-only probe — and if a viewer answers, print its URL and spawn nothing. | The repo's "observability exhaust never kills a run" convention. A detached, unref'd, stdio-ignored child cannot hold the runner open, cannot pollute its stdout, and cannot fail it. |
| **D13** | Any new persisted format? | **None.** No new field on `run.json` or the state file; the viewer's URL is *derived* from `--home` (`repoKey = basename(dirname(dirname(home)))`, `slug = basename(home)`) and printed, never stored. | Card D5 — a new persisted field would require escalating to the owner first. Deriving it removes the need entirely. |
| **D14** | What proves purity for the viewer? | A new `plugins/tribe/scripts/viewer/structure.test.ts`, modelled on the runner's: `core/**` may never contain a world-touching specifier in any quote form; adapters are value-imported only by `serve.ts` or other adapters; no `process.env` outside adapters. | The card's standing constraint says to **extend** the executable purity wall, never weaken it. The viewer has no such wall today; adding one is the extension. |

---

## 4. Architecture

```
                        campaign home (~/.tribe/<repoKey>/campaigns/<slug>/)
                        ├── runs/<runId>/run.json   ──► repo, statePath, logsDir, pid
                        └── campaign-state.json     ──► cards[id].sessionId
                                     │
                 (D1) encodeCwd(run.repo) + sessionId
                                     ▼
        ~/.claude/projects/<encodedRepo>/<sessionId>.jsonl          ← parent transcript
        ~/.claude/projects/<encodedRepo>/<sessionId>/subagents/
              agent-<agentId>.jsonl                                 ← subagent transcript
              agent-<agentId>.meta.json                             ← agentType/description/parent (D3)
                                     │
   ┌─────────────────────────────────┴──────────────────────────────────┐
   │ adapters (the ONLY fs/clock/net importers)                         │
   │   transcript.adapter.ts   realpath, statFile, readRange, listDir   │
   │   poller.adapter.ts       400 ms interval driving the pure core    │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │ pure core (no fs, no clock, no process, no network)                │
   │   live/paths.ts       encodeCwd sanitization + path math           │
   │   live/tail.ts        advanceTail(state, chunk) -> lines + state   │
   │   live/records.ts     tolerant JSONL -> TranscriptRecord[]         │
   │   live/normalize.ts   records -> TranscriptEvent[] (tool pairing)  │
   │   live/markdown.ts    markdown subset -> escaped HTML              │
   │   live/processes.ts   metas + stats -> ProcessNode tree + status   │
   │   live/routes.ts      URL -> Route; frame -> SSE wire text         │
   │   live/page.ts        live page shell (HTML)                       │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     ▼
   serve.ts (composition root)  ──►  GET /        existing status page (D10)
                                     GET /live    page shell + <script src=/app.js>
                                     GET /events  SSE: processes | snapshot | append | ping
                                     GET /api/processes   JSON (machine-readable, e2e)
                                     GET /app.js, /app.css, /healthz
                                     ▼
                              browser: EventSource -> DOM append (D5, D7)
```

The runner side is three small pieces: `core/viewer-launch.ts` (pure decision),
`ports/ports.ts` (`ViewerPort`), `adapters/viewer-launch.adapter.ts` (probe + detached spawn),
wired once in `cli/main.ts` (D11, D12).

### 4.1 Wire contract (fixed in plan Task 1, both tracks build against it)

```ts
// core/live/model.ts — the single contract both tracks compile against.
export interface ProcessNode {
  id: string;                 // "card:<cardId>" | "agent:<cardId>:<agentId>"
  kind: 'session' | 'subagent';
  cardId: string;
  agentId: string | null;
  agentType: string | null;   // e.g. "tribe:hunter"; null when meta is unreadable
  label: string;              // meta.description, else the card id
  parentId: string | null;    // ProcessNode.id of the parent (D3)
  depth: number;
  status: 'active' | 'idle' | 'done' | 'missing';
  startedAt: string | null;
  lastActivityAt: string | null;
  sizeBytes: number;
  toolUseId: string | null;   // links a parent tool_call to this subagent
  transcriptPath: string;
}

export type EventKind =
  | 'user_prompt' | 'assistant_text' | 'thinking'
  | 'tool_call' | 'tool_result' | 'error' | 'result';

export interface TranscriptEvent {
  seq: number;
  kind: EventKind;
  timestamp: string | null;
  html: string;               // already escaped by the pure core (D6)
  toolName?: string;
  toolUseId?: string;
  isError?: boolean;
}
```

SSE frames (event name → `data` JSON):

| Frame | Payload | When |
|---|---|---|
| `processes` | `{ processes: ProcessNode[] }` | on connect, then whenever the list changes |
| `snapshot` | `{ processId, events, truncated, nextOffset }` | once on connect, for the selected process |
| `append` | `{ processId, events, nextOffset }` | on every tick that produced new complete lines |
| `ping` | `{ t }` | every 15 s (keep-alive) |
| `error` | `{ message }` | a per-process read failure; the stream survives |

The initial `snapshot` is capped at the last **400** events with `truncated: true` — bounded
memory and a bounded first paint, both without losing live behaviour.

### 4.2 Routes and their guards

| Route | Response |
|---|---|
| `GET /` | existing status page (unchanged renderer) + one live link per campaign (D10) |
| `GET /live?repo=<repoKey>&slug=<slug>[&process=<id>]` | live page shell |
| `GET /events?repo=…&slug=…[&process=…]` | SSE stream (D4) |
| `GET /api/processes?repo=…&slug=…` | `{ processes }` JSON — the e2e's assertion surface |
| `GET /app.js`, `GET /app.css` | the two static client files, from a fixed allowlist |
| `GET /healthz` | `{ ok: true, viewer: "tribe-live-viewer", v: 1 }` — the runner's reuse probe (D12) |
| anything else | `404` |

`repo` and `slug` are separate parameters (never one slash-joined value) and must match
`^[A-Za-z0-9._-]+$`; anything else is `400` before a single path is built. Static assets are
served from a two-entry allowlist, never by joining a request path — path traversal is
impossible by construction rather than by sanitisation.

---

## 5. Data flow, tick by tick

1. Browser opens `/live?repo=…&slug=…`; the shell renders with an empty process list and loads
   `/app.js`, which opens `EventSource('/events?repo=…&slug=…&process=…')`.
2. On connect the server: reads the campaign's newest `run.json` and state file (reusing the
   existing scan adapter's primitives), resolves the project dir (D1/D2), lists the
   `subagents/` dir plus sidecars, derives `ProcessNode[]` (D3), and emits `processes`, then a
   `snapshot` for the selected process (default: the newest running card's session node).
3. Every 400 ms the poller (D8/D9):
   - re-`readdir`s the `subagents/` dir → a new `agent-*.jsonl` produces an added `ProcessNode`
     and a fresh `processes` frame (G2's second half);
   - `stat`s the selected process's file; if it grew, reads exactly the new bytes, feeds
     `advanceTail`, parses complete lines, normalizes them, and emits `append`.
4. The client appends DOM nodes and keeps the view pinned to the bottom unless the reader has
   scrolled up. Thinking blocks render collapsed; tool calls render as a call card whose result
   is filled in when the paired `tool_result` arrives.
5. On disconnect the poller is cleared. Nothing is ever written, anywhere (G4).

**Normalization rules** (`core/live/normalize.ts`, pure):

- Accept both `sessionId` and `session_id` (card D7); accept a missing `type: "system"` row
  (card D7 — this CLI writes none) and render one if present.
- Skip non-message rows: `attachment`, `queue-operation`, `last-prompt`, `ai-title`, `mode`,
  `pr-link`, `summary`, `custom-title`.
- `user` with string content → `user_prompt`; `user` with `tool_result` blocks → `tool_result`,
  paired by `tool_use_id` into the already-emitted `tool_call` (Kanna's pending-map shape,
  `parseTranscript.ts:115-216`).
- `assistant` content blocks → `assistant_text` (markdown, D6) / `thinking` (collapsed, signature
  never rendered) / `tool_call` (name + input summary).
- `model: "<synthetic>"` is **not** treated as an error (card D7).
- An unparseable line is counted and skipped — never thrown, never rendered as raw JSON.

**Process status** (pure): `missing` (no file) → `done` (the parent transcript carries a
`tool_result` for this node's `toolUseId`, or the card's state status is terminal) → `active`
(mtime within 10 s of `now`) → `idle`.

---

## 6. Runner auto-start (D11, D12)

```
core/viewer-launch.ts   (pure)  decideViewerLaunch({ dryRun, disabled, port, homeDir, viewerEntryExists, probeOk })
                                  -> { kind: 'skip' | 'reuse' | 'spawn', url, argv }
ports/ports.ts          (type)  ViewerPort { probeViewer(port): Promise<boolean>; spawnDetached(argv): void }
adapters/viewer-launch.adapter.ts  fetch(`http://127.0.0.1:<port>/healthz`) + spawn(detached, stdio ignore, unref)
cli/main.ts             (wire)  after parseArgs / before runLoop; try/catch; one console.log line
```

Printed line (G3):
`campaign viewer: http://127.0.0.1:4321/live?repo=<repoKey>&slug=<slug> (read-only)`

The viewer entry is resolved from the adapter's own `import.meta.dir` as a plugin-internal
sibling (`../../viewer/serve.ts`) — not an environment value, so the stateless-capability wall is
untouched; a missing entry degrades to `skip` with one stderr note. `--dry-run` never reaches
this code path (zero side effects stays a hard contract).

New flags are additive and rejected-by-name behaviour is preserved: `--viewer-port` and
`--no-viewer` join `KNOWN_FLAGS`, the README's CLI table, and the SKILL.md contract table.

---

## 7. Repo governance conformance

| Constraint | How this design satisfies it |
|---|---|
| Pure core / impure edges (`plugins/tribe/rules/pure-core.md`) | Every decision, parse, and render is a pure function over injected data; `fs`, the clock, `spawn`, and the network exist only in `adapters/` and the two composition roots. The client obeys the same shape (D7). |
| `structure.test.ts` extended, never weakened | Runner's stays byte-identical and green (D11's placement is chosen for exactly that); the viewer **gains** its own (D14). |
| Worktree-first, regular merge, never squash | The plan runs in worktrees off `master@5e8c095`; one PR, regular merge. |
| Never add an agent name as co-author | Stated in the plan's Global Constraints. |
| Progressive disclosure | `scripts/viewer/README.md` (new), `scripts/runner/README.md`, `plugins/tribe/README.md` updated in the same PR. |
| C3 | `.c3/c3-2-plugins/c3-215-tribe.md` — the `scripts/viewer/serve.ts` contract row is rewritten and the runner row gains the two flags. **There is no `c3` executable**: the runtime is `c3x`, invoked through the c3 skill's own wrapper (`<skill-dir>/bin/c3x.sh`), so the plan names that invocation rather than a bare `c3 check`. Verified on `master@5e8c095`: `c3x check` already fails with **two pre-existing, unrelated errors** (`c3-213`, `c3-216`: ungrounded Derived-Materials derivations) and `c3x check --only c3-215` already reports canonical-markdown drift. The plan therefore scopes repair to `c3-215` and requires the pre-existing failures to be recorded in the PR body and left untouched. |
| `install.sh` | The viewer stays repo-invoked (`scripts/` is deliberately skipped, `install.sh:119-121`); the plan's docs task verifies and records that no installer change is needed. |
| `html-illustration.md` | The served pages are the repo's own application markup (the rule's stated exclusion), so its *palette* stays the existing status page's for continuity — but because a human reads this page as the deliverable, the plan adopts the rule's **structural numbers** (container width, type scale, reading measure, panel caps, spacing rhythm) for `/live`. |
| Debt blacklist (`.c3/documents/debt/`) | Checked before authoring: **the directory does not exist in this repo**, so there is no open debt entity or anti-rule this design could reintroduce. Nothing was assumed — the absence itself is the finding. |

---

## 8. Testing strategy

- **Pure core** (the bulk): fixture-driven unit tests, no fs. Fixtures are copied in-repo from
  the shapes verified in §1.1 — a valid transcript, a malformed one, an empty one, a subagent
  sidecar pair — following Kanna's `__fixtures__` pattern without importing Kanna.
- **Tail**: byte-split matrix — a line split across three chunks, a chunk ending exactly on a
  newline, CRLF, an empty line, a truncation (size decrease) reset.
- **Normalize**: one test per record shape, plus the three card-D7 gotchas as explicit cases.
- **Adapters**: temp-dir tests writing real files, then appending to them, asserting the adapter
  yields exactly the new bytes.
- **Client**: `bun test` imports `client/app.js` with fake `EventSource`/`document`.
- **Structure**: the new viewer `structure.test.ts` (D14) plus the runner's, unchanged.
- **e2e (opt-in, card D4)**: `TRIBE_VIEWER_E2E=1`, real `run.ts`,
  `--model claude-haiku-4-5-20251001`, short `--session-timeout`, throwaway `git init` repo under
  a temp dir **with no git remote configured** so a PR on a real remote is impossible; asserts
  the parent session and ≥1 subagent appear in `/api/processes`, and measures latency.

## 9. Evidence plan (G5 — captured by the Warchief, not claimed by a Hunter)

All artifacts land in `docs/superpowers/evidence/2026-09-02-campaign-live-viewer/`:

| Artifact | How it is produced |
|---|---|
| `before-status-page.png` | Chrome headless screenshot of `GET /` built from `master@5e8c095` — the raw-JSON `<pre>` tail. |
| `after-live-parent.png` | Chrome headless screenshot of `/live` during the real Haiku run, parent transcript rendered as messages. |
| `after-live-subagent.png` | Same run, a subagent's transcript selected. |
| `latency.json` | Emitted by the e2e: per-append `mtimeMs` → SSE arrival delta, plus max/median; asserted ≤ 2000 ms. |
| `processes.json` | `/api/processes` capture proving parent + ≥1 subagent with agent types. |
| `commands.md` | Every command line used, verbatim and re-runnable. |

Screenshots use the machine's installed Chrome in `--headless=new --screenshot` mode — **verified
working on 2026-09-02** against a JS-rendered page, and adding **zero** repo dependencies. If
Chrome is absent the e2e still passes and records why the image step was skipped.

## 10. Risks and rollback

| Risk | Mitigation |
|---|---|
| A Hunter's pure module accidentally imports `node:fs`, surfacing only after the wave merge | Every wave-1 brief states the rule; the wave-2 integration task re-runs the full suite including the new `structure.test.ts`. |
| Chrome absent / headless flaky on another machine | Evidence step is skip-safe and reports the skip; the latency proof (the objective claim) needs no browser at all. |
| Transcript volume makes the first paint heavy | `snapshot` capped at 400 events with `truncated: true` (§4.1). |
| Claude Code changes the on-disk layout | Every reader is tolerant by construction (skip unknown, never throw); the fixtures pin today's shape so a change fails loudly in tests, not silently in the page. |
| The spawned viewer interferes with a run | D12: detached, `stdio: 'ignore'`, `unref`ed, try/catch, `--no-viewer` escape hatch. |
| No `timeout(1)` binary on this machine | Every wait in the e2e is bounded in TypeScript (`AbortSignal.timeout` / deadline loops), never by a shell `timeout`. |
| Pre-existing C3 failures make "green C3" ambiguous | Measured on `master@5e8c095` before any change (§7): two unrelated component errors plus canonical drift on `c3-215`. The docs task repairs `c3-215` only, and the PR body records the before/after of both, so a Skinner can tell our work from the inherited state. |

**Rollback:** the change is additive. Reverting the runner's four-line wiring (D11) restores the
previous launch behaviour exactly; deleting `core/live/`, `client/`, and the new routes restores
today's status page, whose code and tests this design does not modify.

## 11. Verification contract (what "done" means)

1. `cd plugins/tribe/scripts/viewer && bun run check` — green (`tsc --noEmit` + `bun test`),
   including the new `structure.test.ts`.
2. `cd plugins/tribe/scripts/runner && bun run check` — green, `structure.test.ts` unchanged.
3. `bash plugins/tribe/scripts/tests/test-validate-plan.sh` and the other script tests — green;
   `c3x check --only c3-215` clean via the c3 skill's wrapper, with the two inherited
   component errors unchanged and recorded.
4. `TRIBE_VIEWER_E2E=1 bun test e2e/live-viewer.e2e.test.ts` — parent + ≥1 subagent rendered,
   measured latency ≤ 2 s, evidence written.
5. A dry-run and a real runner invocation both behave as D11/D12 specify (URL printed, run
   unaffected, `--dry-run` writes and spawns nothing).
6. Dual-Skinner audit closed, `scout` survey and `tracker` review dispositioned, PR green,
   regular-merged.
