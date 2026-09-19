# e2e — the DOM-level and process-level proofs (spec §16)

Every user-visible goal in the card (G1, G2, G4, G6) is proved **in a real browser against the
real server**, never at a unit or API boundary alone — spec §2's goal map names the reason: a unit
test can pass while what a person actually sees is broken (a missing kind, a dropped write-guard,
a served file that differs from the built one). The files below are that proof layer, plus the two
opt-in suites that exercise a real campaign runner on a real Haiku 4.5 session.

`browser.ts` is a shared helper, not a test: it resolves a real, installed Chromium executable from
Playwright's own registry and **fails closed** — it throws with a one-line remedy
(`bunx playwright install chromium`) rather than returning nothing, so a missing browser can never
turn into a silent skip (spec §16.0).

## Always-on (plain `bun test`, no environment variable)

These are **not** gated behind an environment variable and **fail** — never skip — when no
Chromium resolves, which is deliberate: a user-visible goal must never go green because its
browser happened to be missing (spec §16.0, R8).

- **`dom-kinds.e2e.test.ts`** (G1, G4) — headless Chromium against the real server and a fixture
  tree built from nothing (`~/.tribe` absent, `HOME`/`CLAUDE_CONFIG_DIR` pointed at a synthetic
  `homeA`). Proves every one of the 12 `RENDER_NODE_KINDS` renders (the runtime witness in
  `core/model.ts`, so the kind list cannot silently drift from the type), plus one DOM assertion
  per distinguishable input shape (string vs array prompt, pending/ok/error tool, orphan result,
  empty vs non-empty thinking, base64 image, compaction divider, `<persisted-output>` spill,
  unknown row type), plus the D10 project-window listing in both directions. It also carries G4's
  DOM-level zero-write proof: the fixture tree is hashed before and after, byte-identical.
- **`real-transcript.e2e.test.ts`** (G1) — the same class of DOM assertions as `dom-kinds`, run
  **read-only** against the largest real transcript on this machine (13,178,184 B, spec §14's
  measured ceiling) and one real session with subagents, against the owner's real
  `~/.claude/projects` (never a fixture). Its zero-write proof is scoped to exactly the files it
  opens, hashed before and after.
- **`served-build.e2e.test.ts`** (G6) — moves any existing `dist/` aside, runs the real build,
  hashes every produced file, starts the real server, fetches `/` and every asset a browser would
  load, and asserts the served bytes hash-match the built bytes — then restores the prior `dist/`
  in a `finally`. The server has no `--dist` override flag, so this is the only honest way to prove
  "served == built".
- **`url-refusals.e2e.test.ts`** (G4) — the URL/security matrix over real HTTP against a real
  `serve.ts` child process (status codes and bodies, not DOM — that is `dom-kinds`'s job): path
  containment, `Host`/`Origin` refusals, and the rest of the refusal matrix spec §16.2 names.

```sh
cd plugins/tribe/scripts/viewer && bun test    # runs everything above; needs a real Chromium
```

## Opt-in behind `TRIBE_VIEWER_E2E=1`

Three suites are gated behind `test.skipIf(!ENABLED)` so a plain `bun test` never spends a token,
spawns a campaign runner, or runs a real ten-minute wall-clock window:

- **`perf.test.ts`** (spec §14) — every performance budget in the table, measured against the real
  corpus and written unconditionally to `e2e/output/perf.json` (a missed budget is recorded, never
  widened to pass). Includes the 8-concurrent-streams RSS measurement, both at open and again after
  a real 10-minute window of appends.
- **`live-tail.e2e.test.ts`** (G2, spec §16.3) — a controlled writer the test itself owns appends
  rows to a real, growing transcript and measures append-to-arrival latency from its own
  `performance.now()`, written to `e2e/output/latency.json`. Also proves the subagent-append case,
  the §8.3 follow/scroll contract on real `scrollTop` readings, live-patch, reconnect, window
  eviction, and same-size rotation. A real `claude -p` Haiku 4.5 session runs alongside purely as a
  realism check — no assertion depends on its content, and its absence never fails the suite.
- **`campaign-badge.e2e.test.ts`** (G3, spec §16.4) — a real campaign runner run on real Haiku 4.5:
  both stdout lines (`campaign viewer: ...`, `card ...: ...`) captured verbatim, the badge asserted
  in the DOM, the filter proved by clicking the badge element. Its fixture carries two campaigns
  sharing one slug under two repo keys, the collision spec §9 measures on this machine.

```sh
cd plugins/tribe/scripts/viewer && bun test                                     # all three skipped
cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/perf.test.ts
cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/live-tail.e2e.test.ts
cd plugins/tribe/scripts/viewer && TRIBE_VIEWER_E2E=1 bun test e2e/campaign-badge.e2e.test.ts
```

## Visual parity evidence (a script, not a test)

`visual-parity.ts` is a **capture tool**, not a test — it is named without `.test.` so `bun test`
never picks it up. It produces the before/after side-by-side screenshot set the owner compares
against the sea-salt reference (`docs/tribe/planning/viewer-consolidation/design/sea-salt/preview.html`
§C/§D). It builds a fresh `homeA` fixture from nothing, starts the real `serve.ts` against it, drives
headless Chromium at 1280×900, and shoots the list, project, and session pages (plus the session with
its first tool card expanded) in both `light` and `dark`, each paired with the matching preview
`.screen` reference. It requires a built `dist/` and a real Chromium, and refuses with one line (no
stack trace) if either is missing.

```sh
cd plugins/tribe/scripts/viewer
bun run build
bun e2e/visual-parity.ts --out ../../../../docs/tribe/planning/viewer-visual-parity/evidence/before
# optional: also capture the owner's real session (read-only, against the real ~/.claude/projects)
bun e2e/visual-parity.ts --out <dir> --session <session-id>
```

The output (`index.html` + PNGs) is committed under
`docs/tribe/planning/viewer-visual-parity/evidence/before/`; open `index.html` to view the pairs.

## `output/`

Git-ignored (`e2e/output/`, see the package `.gitignore`). Holds artifacts written by the opt-in
suites above — `perf.json`, `latency.json`, screenshots — reproducible from a real run and never
checked in. `docs/tribe/planning/viewer-consolidation/evidence/` cites their numbers inline for
exactly this reason.

## Prerequisites

A real, installed Chromium (`bunx playwright install chromium` — `playwright-core` is a pinned
devDependency but never downloads a browser itself). The two opt-in Haiku suites additionally need
a real Claude Code login (never `ANTHROPIC_API_KEY` alone) and `bun`.
