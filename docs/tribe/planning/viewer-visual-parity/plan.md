# Plan — viewer-visual-parity

**Card (the spec for this plan):** `~/.tribe/-Users-hip-repo-tribe/cards/viewer-visual-parity.md`
(goals V1–V3, scope fence). **Visual reference (the oracle for looks):**
`docs/tribe/planning/viewer-consolidation/design/sea-salt/preview.html` — section C (session list),
D (one session), E (components) — and its screenshots `preview-light.png` / `preview-dark.png`
beside it. **Tokens:** `docs/tribe/planning/viewer-consolidation/design/sea-salt/tokens.css`
(already `@import`ed by `client/src/styles/index.css`). **Prior spec for the component tree:**
`docs/tribe/planning/viewer-consolidation/spec.md` §8.1–§8.2.

`V` below = `plugins/tribe/scripts/viewer`. All commands run from `V`.

## Baseline (measured 2026-09-19 on master 72c73cd)

- `bun run build` → exit 0. `bun test` → **872 pass, 3 skip, 0 fail** (45 files).
- `client/src/styles/app.css` = 75 lines; it styles `.app-shell`, `.app-shell__title`,
  `.app-shell__meta`, `.rows`, `.session-view`, `#root`, `body`. Every other class in
  `client/src/components/*.tsx` has no rule.

## Global Constraints (every task)

1. **Oracle.** For how things look: `preview.html` §C/§D/§E is the contract. Match its layout,
   surfaces, rules, type scale, and component shapes. The real app has elements the preview does
   not show (error card, raw card, image, attachment strip, divider, markdown, load-earlier,
   connection note…): style them in the same vocabulary (hairline rules, `--surface` panels,
   mono 12–13 soft metadata, accent only as stroke / small text). Under-styling (an element left
   at browser defaults: bullets, default buttons, glued text) is a bug; a judgment call on an
   element the preview does not show is by design.
2. **Tokens only.** `structure.test.ts` bans, anywhere under `client/`: `#rgb`/`#rrggbb`, `rgb(`,
   `rgba(`, `hsl(`, `oklch(`, a `font-family:` not starting with `var(`, and any bare `Npx`
   length. Every colour, font, size, space, radius, shadow is `var(--token)` from `tokens.css`.
   preview.html's own px literals (248px sidebar, 9px dot, 3px padding, 999px radius…) are
   translated: to the nearest token, or — only for a layout dimension no token covers — a
   relative unit (`rem`, `ch`, `%`, `fr`) with a one-line comment naming the preview value it
   stands for. Never add a token, never copy a literal.
3. **DOM contract.** `data-kind`, `data-row-id`, `data-scroll="rows"` stay exactly as emitted.
   Markup changes are limited to what styling needs: class names, a wrapper element, a visible
   separator (e.g. `" · "` between metadata spans). No behaviour, route, server, SSE, or state
   change.
4. **Existing tests.** Their assertions stay unchanged. The one allowed exception: a text
   assertion that a visible separator necessarily changes — update it minimally and name every
   such edit in the task report.
5. **TDD.** Write the failing test first, watch it fail, then style until green.
6. **Proof per task:** `bun test` (full, includes the always-on e2e suites; needs Chromium — it
   is installed), `bun run build`, `bun run check:client`. All green; pass count ≥ baseline.
7. **Commits:** conventional messages, **no `Co-Authored-By` line** (owner rule). Commit only
   under `V/` and `docs/tribe/planning/viewer-visual-parity/`.
8. Dark mode is free: `tokens.css` switches on `prefers-color-scheme`. Do not add a toggle and do
   not re-declare token values.

---

### Task 1: The ratchet — an unstyled-class counter with a committed ceiling

**Goal:** V1's measuring tool exists, is tested, and its baseline is committed, before any
styling.

**Files:** create `V/tools/unstyled-classes.ts`, `V/tools/unstyled-classes.test.ts`,
`V/tools/unstyled-classes.ratchet.test.ts` (under `tools/`, not `client/`: client code may not read the filesystem).

1. `tools/unstyled-classes.ts` — a **pure core** `findUnstyledClasses(tsxSources: string[],
   cssSources: string[]): { used: string[]; unstyled: string[] }` plus a thin CLI edge
   (`import.meta.main`) that reads `client/src/components/*.tsx` and `client/src/**/*.tsx` and
   `client/src/styles/*.css`, prints `unstyled N of M` then one class per line, exit 0.
   - "Used" = every class token in a `className` attribute: `className="a b"`, and every string
     literal / template-literal static segment inside `className={…}` (so
     `` className={`tool tool--${state}`} `` yields `tool`; a dynamic modifier is not a class
     name and is skipped; `cond ? 'a' : 'b'` yields both). Tokens must match
     `/^[A-Za-z_][\w-]*$/`.
   - "Styled" = the class appears as `.name` in any selector of the CSS (followed by a
     non-identifier char or end), anywhere in a selector list or compound selector.
2. `tools/unstyled-classes.test.ts` — unit tests over inline strings covering each extraction
   shape above, a selector-list case (`.a, .b {}`), a compound case (`.a.b`, `.x .a:hover`), a
   prefix trap (`.tool` must NOT count `.tool__name` as styling `tool`, and vice versa), and an
   empty stylesheet (every used class is unstyled).
3. `tools/unstyled-classes.ratchet.test.ts` — runs the core over the real files and asserts
   `unstyled.length <= UNSTYLED_CEILING`, where `UNSTYLED_CEILING` is a named constant set to
   **today's measured count** (run the CLI first; put the number and the date in a comment).
   The failure message lists the unstyled classes. Add a second assertion that `used.length`
   is > 0 (a scanner that finds nothing must not pass).
4. Record the measured baseline (`unstyled N of M`) in the report.

Proof: the three tests pass; the CLI prints the baseline; full `bun test` green.

---

### Task 2: The visual evidence — side-by-side capture script and the BEFORE set

**Goal:** V2(b)'s capture tool exists and the "before" screenshots are committed, so the owner
can compare before/after against the reference.

**Files:** create `V/e2e/visual-parity.ts` (a script, not a test; EDGE code like the other e2e
files), `V/e2e/visual-parity.README.md` is NOT wanted — document usage in `V/e2e/README.md`
instead. Output committed under `docs/tribe/planning/viewer-visual-parity/evidence/before/`.

1. `bun e2e/visual-parity.ts --out <dir>`:
   - builds a fresh fixture home with `buildHomeA` (from `fixtures/build.ts`) in a `mkdtemp`
     dir, starts the real `serve.ts` as a child with `HOME` / `CLAUDE_CONFIG_DIR` pointed there
     (copy exactly how `e2e/dom-kinds.e2e.test.ts` starts it: free port, wait for the startup
     line, kill in `finally`), and requires a built `dist/` (run `bun run build` first; refuse
     with a one-line message if `dist/index.html` is missing).
   - launches Chromium via `resolveChromiumExecutable()` from `e2e/browser.ts`, viewport
     1280×900.
   - for each colour scheme in `light`, `dark` (`page.emulateMedia({ colorScheme })`):
     screenshots `/` (list), `/p/<PROJECT_A_DIR>` (project), `/s/<SESSION_1_ID>` (session; also
     click to expand the first tool card if one exists, then screenshot again), and the
     preview's §C and §D screen elements (open `preview.html` via `file://`; select the two
     `.screen` elements under the sections headed "C." and "D."; element screenshots).
   - writes `<dir>/index.html`: for each scheme, rows of [live screen | preview reference] side
     by side with captions, images referenced relatively. Plain HTML; this file is outside
     `client/`, so the literal ban does not apply, but keep it minimal.
   - optional `--session <id>` adds the owner's real session from the real `~/.claude/projects`
     (read-only: start a second server with the real `HOME`, never write).
   - every `subprocess`/`spawn` has a timeout or is killed in `finally`; a missing browser or
     dist refuses with one line, never a stack trace.
2. Run it: `bun run build && bun e2e/visual-parity.ts --out ../../../../docs/tribe/planning/viewer-visual-parity/evidence/before`
   and commit the output (PNGs + index.html).
3. Document the command in `V/e2e/README.md` (a short "Visual parity evidence" section).

Proof: the script runs from a clean state and writes the files; each PNG is non-trivial
(> 5 KB); full `bun test` still green (the script is not a test file, so it must not be picked
up by `bun test` — name it without `.test.`).

---

### Task 3: Style the session-list screen (shell, sidebar, project rows, session rows, badge, dot)

**Goal:** `/` and `/p/<dir>` match preview.html §C.

**Files:** modify `V/client/src/styles/app.css` (you may split into
`client/src/styles/list.css` imported from `index.css` after the tokens import); minimal markup
edits in `client/src/components/{Sidebar,ProjectList,CampaignFilter,ShowOlderProjects,SessionList,SessionRow,CampaignBadge,LiveDot,App-level shell}` as needed; create
`V/e2e/visual-contract.e2e.test.ts`.

1. **Test first.** `e2e/visual-contract.e2e.test.ts` — started the same way as
   `dom-kinds.e2e.test.ts` (real server, `buildHomeA` fixture, real Chromium, fail-closed, no
   skip). For the list screen, assert COMPUTED styles against the RESOLVED token values (read
   the token value in the page with
   `getComputedStyle(document.documentElement).getPropertyValue('--surface')` and compare to the
   element's computed property, normalising colour formats by assigning both to a probe
   element), at minimum:
   - the page is a two-column layout: sidebar and main side by side (bounding boxes: sidebar
     left of main, same top ± a few px), sidebar background = `--surface`, with a right
     border in `--rule`;
   - project rows: `list-style` none (no bullet marker), name in the mono font
     (`font-family` contains the first family of `--font-mono`), count visually separated
     (the count element is a separate box right of the name, not glued text), active project
     has the accent inset/stroke;
   - session rows: each row has a bottom border in `--rule`; title font-size = `--size-16`;
     age in mono `--size-12` colour `--ink-soft`; metadata items separated (visible `·` or a
     gap ≥ `--space-8` between their boxes);
   - campaign badge: background `--badge-bg`, colour `--badge-ink`, border-radius
     `--badge-radius`, mono font, its parts visibly separated;
   - live dot: a circle (width = height, border-radius ≥ half) filled `--live`; idle dot has no
     fill and a `--rule` border;
   - the filter input and "show N older projects" link are styled (input border `--rule`,
     link colour `--accent`).
   Run it against the unchanged CSS: it must FAIL (record the failure count in the report —
   this is the empty-implementation proof).
2. **Style** until green. Match preview §C: 248px-equivalent sidebar, `.screen`-style framed
   panel (`--surface-raised`, hairline border, `--radius-8`, `--shadow`), uppercase 12px
   `PROJECTS` heading in `--ink-soft`, header strip for the main column showing the project path
   and "N sessions · newest first" metadata in the preview's style.
3. Take a look yourself: run `bun e2e/visual-parity.ts --out /tmp/vvp-t3` and open the list
   screenshots next to the preview; fix anything that visibly differs in shape. Say in the report
   what you compared.

Proof: new test green, full `bun test` green, build + check:client green,
`bun tools/unstyled-classes.ts` count lower than Task 1's baseline (report both numbers). Lower
`UNSTYLED_CEILING` to the new count (the ratchet only moves down).

---

### Task 4: Style the session view (header, tabs, transcript rows, tool cards, pills, every kind)

**Goal:** `/s/<id>` matches preview.html §D, and every row kind the app renders is styled.

**Files:** CSS (you may add `client/src/styles/session.css`, imported from `index.css`); minimal
markup in `client/src/components/{SessionView,AgentTabs,RowList,PromptCard,AssistantCard,ThinkingCard,ToolCard,OrphanResultCard,ImageCard,AttachmentStrip,ChipRow,Divider,RawCard,ErrorCard,UnreadableNote,Markdown,BlockExpander,FollowTail,NewBelowPill,LoadEarlier,ConnectionNote}`;
extend `V/e2e/visual-contract.e2e.test.ts`.

1. **Test first** (extend the file; must fail before styling — record the count):
   - header strip: background `--surface`, bottom border `--rule`, title weight ≥ 600; the live
     indicator is a pill (border colour `--accent` or `--live`, fully rounded);
   - agent tabs: mono `--size-12`, inactive colour `--ink-soft`, the active tab has a bottom
     border in `--accent`;
   - prompt card: role label "YOU"-style (uppercase via `text-transform`, mono 12, colour
     `--accent`); assistant role label colour `--ink-soft`; message body mono `--size-14` with
     line-height `--leading-loose`;
   - thinking: italic, `--ink-soft`, left border in `--rule`;
   - tool card: border `--rule`, background `--surface`, radius `--radius-4`; header row mono
     `--size-13` with the tool name bold; outcome colour `--live` for ok, `--error` for error,
     `--warn` for pending (use the fixture's ok / error / pending tools — see
     `fixtures/build.ts` `TOOL_USE_IDS`); expanded body background `--surface-raised` with a top
     rule;
   - orphan result: stroke in `--warn`; error card: stroke/text `--error`; raw card and
     unreadable note: `--ink-soft` mono, bordered;
   - chip row chips: `.tag` shape (mono 12, `--rule` border, `--radius-4`);
   - divider: a hairline in `--rule` with its label `--ink-soft`;
   - follow-tail / new-below pills: `.pill` shape (accent text + accent border, fully
     rounded), positioned over the row list bottom-right, not in the flow;
   - buttons (load earlier, block expander): not browser-default (border `--accent` or
     ghost style per preview §E `.btn`), focus-visible shows `--focus-ring`;
   - markdown: inline `code` mono, `pre` on `--surface` with a `--rule` border, links `--accent`.
2. **Style** until green, matching preview §D (transcript padding, message rhythm, tool-head
   layout with caret · name · arg (ellipsis) · outcome right-aligned).
3. Look at it: run the capture script, compare session screenshots to preview §D, fix visible
   shape differences; say what you compared.

Proof: as Task 3; lower `UNSTYLED_CEILING` to the new count.

---

### Task 5: Close the ratchet, dark mode, AFTER evidence, docs

**Goal:** V1 reaches 0, V2 is proven in dark too, the after-evidence is committed.

1. **Test first:** in `visual-contract.e2e.test.ts` add a dark block
   (`page.emulateMedia({ colorScheme: 'dark' })`): body background equals the dark `--paper`
   resolved in that scheme and differs from the light value; sidebar = dark `--surface`; one
   badge and one tool card resolve to their dark token values. Must fail only if something is
   hard-wired (it may pass immediately — that is fine, say so).
2. Style every remaining class `bun tools/unstyled-classes.ts` lists (or delete the class from
   the markup if it is genuinely unused by any styling intent — name each in the report). Set
   `UNSTYLED_CEILING = 0`.
3. `bun run build && bun e2e/visual-parity.ts --out ../../../../docs/tribe/planning/viewer-visual-parity/evidence/after`,
   commit the output.
4. Docs: `V/README.md` gains a short "Look and feel" section: tokens source, the ratchet test,
   the visual-contract e2e, and the capture command. No other doc changes.

Proof: full `bun test` green (pass count ≥ 872 + new tests), build + check:client green,
`bun tools/unstyled-classes.ts` prints `unstyled 0 of M`.
