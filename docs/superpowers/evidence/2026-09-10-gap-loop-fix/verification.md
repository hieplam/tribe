<!-- Produced 2026-09-10 by a sonnet verifier over ~/.claude/projects transcripts and gh PR bodies; commands inline. -->
# Verification Report

## C1 — No `harness-gaps.jsonl` anywhere under `~/repo` or `~/.tribe`
**Verdict: CONFIRMED**
```
$ find ~/repo ~/.tribe -name harness-gaps.jsonl 2>/dev/null
(no output)
$ find ~ -name harness-gaps.jsonl -not -path '*/node_modules/*' 2>/dev/null | head
(no output)
```
No such file exists anywhere on the machine.

## C2 — Tracker subagent runs, "Harness gaps" mentions, real HG-candidate blocks
**Verdict: CONFIRMED (with corrected counts)**

- Tracker `.meta.json` files with `"agentType":"tracker"`: **118**
- Of those 118 transcripts, **101** contain the literal string `Harness gaps`.
- Of those 101, **15** contain a line matching `HG-candidate [0-9]` *somewhere* in the file, but many of those hits are inside tool-input echoes/report drafts, not the transcript's final assistant message.
- Restricting to the **FINAL assistant-role text message** in each transcript: **7 of 118** tracker transcripts carry a genuine `HG-candidate [0-9]` block in their last message:

| session-uuid | transcript | first ~200 chars of HG-candidate block |
|---|---|---|
| `93fe0a83-ed16-4198-b1f6-d9581746a377` | `subagents/agent-afb5aa0de6d136058.jsonl` | `### Harness gaps\nHG-candidate 1 [test-presence] — every file under runner/adapters/ ships with no dedicated *.test.ts. Evidence: for f in adapters/*.ts; do [ -f "${f%.ts}.test.ts" ] ...` |
| `5c91125c-780e-4b72-93a7-31ec994dad58` | `subagents/agent-ad86f7e6c1e139a7d.jsonl` | `HG-candidate 1  [error-handling]  diff FOLLOWS an undocumented pattern\n  Pattern: Parse functions signal failure via a discriminated-union return ({error: string} vs. success shape)...` |
| `56af20da-746d-43ec-9967-0b98d1c9f1e2` | `subagents/agent-afcb56fa9e696c548.jsonl` | `### Harness gaps\n**HG-candidate 1 [error-handling]** — the diff follows an undocumented pattern: catch { ... } blocks that discard the caught error with no log/re-throw...` |
| `56af20da-746d-43ec-9967-0b98d1c9f1e2` | `subagents/agent-a2e7d7c3454190d80.jsonl` | `**HG-candidate 1 [error-handling]** — bare catch { } blocks that collapse multiple distinct failure modes into one silent sentinel, e.g. plugins/explaining/.../validate-mermaid.ts:180,190,285,314,325...` |
| `ae4731e3-92b0-4dca-9b76-a86acb56de91` (Kanna) | `subagents/agent-a9894f39a7813efa6.jsonl` | `HG-candidate 1  [error-handling]  diff FOLLOWS an undocumented, forked convention\n  Pattern: catching a boundary error and narrowing it to a message uses two competing, mutually-exclusive idioms...` |
| `ae4731e3-92b0-4dca-9b76-a86acb56de91` (Kanna) | `subagents/agent-af34ff9a051656e4f.jsonl` | `HG-candidate 1  [test-presence]  diff FOLLOWS an undocumented pattern\n  Pattern: dev/test-harness infrastructure scripts ship with no unit tests, and e2e/boot.ts's new helpers...` |
| `ae4731e3-92b0-4dca-9b76-a86acb56de91` (Kanna) | `subagents/agent-ac858971df60ed6bc.jsonl` | `HG-candidate 1  [resource-cleanup]  diff FOLLOWS an undocumented pattern\n  Pattern: process-group SIGTERM-then-SIGKILL-after-grace kill logic (process.kill(-pid, signal)) is hand-reimplemented...` |

## C3 — Warchief subagent runs, `gap-reconcile` mentions
**Verdict: CONFIRMED**
- Warchief `.meta.json` files: **43**.
- Of those, **12** transcripts mention `gap-reconcile`.
- Actual Bash `"command":"..."` tool-inputs containing `gap-reconcile` inside all 43 transcripts: **zero**. Every hit is either (a) an `ls`/plan listing showing `gap-reconcile.ts`/`gap-reconcile.test.ts` exist in `plugins/tribe/scripts/gaps/`, or (b) prose reasoning, e.g.:
  - `agent-ac0757ec154a69139.jsonl`: *"gap-reconcile can be skipped since Tracker reported no HG candidates, but the unconditional debt-count.ts diff gate and debt-backfill.ts still need to run..."*
  - `agent-a4ef3b5649e40df3f.jsonl`: *"Since the tracker found no harness gaps, gap-reconcile isn't needed, but I should still check whether debt-count.ts and debt-backfill.ts exist..."*
  - `agent-a73935584fa9a54e0.jsonl`: *"...so the final whole-branch reconciliation feeds it to gap-reconcile.ts rather than losing it — I mint and match no id by hand."*
  - `agent-ae35de9e239ef689b.jsonl`: `"--- registry ---\n(no registry)"` — a warchief explicitly checked and found no registry file.
- **No invocation of `bun ... gap-reconcile.ts ... --candidates` was found anywhere.** Every mention is either an existence check or forward-looking prose ("will feed it to", "can be skipped"), never an actual executed reconciliation.

## C4 — `"minted":[` and `gap-reconcile.ts --registry` across ALL transcripts
**Verdict: CONFIRMED**
- `"minted":[` — **0 matches** anywhere under `~/.claude/projects`.
- `gap-reconcile.ts --registry` — **6 matches**, all non-executions:

| file | one-line context |
|---|---|
| `-Users-hip-repo-tribe/18904cff-...-0684.jsonl` (this session) | quoting the task prompt itself (self-reference, not evidence) |
| `-Users-hip-repo-tribe/e6d2fd42-...-8f98.jsonl` | source comment: `// CLI contract:\n//   bun gap-reconcile.ts --registry <path> --changed-files <comma-list> --candidates <json-file>` |
| `.../e6d2fd42.../subagents/agent-ad21299e1b9075149.jsonl` | doc "Golden Example": `$ bun gap-reconcile.ts --registry .tribe/harness-gaps.jsonl --changed-files src/handlers/payment.ts --candidates c1.json` |
| `.../e6d2fd42.../subagents/agent-a60e5866a0ddc0e3c.jsonl` | same doc example |
| `.../e6d2fd42.../subagents/agent-a16d32802d30bdbdb.jsonl` | same doc example |
| `-Users-hip-repo-tribe/18904cff-.../subagents/agent-a512e0ec373be12cf.jsonl` | quotes this same C4 task-prompt text (self-reference) |

None is a real execution — all are source-code CLI-contract comments, illustrative "Golden Example" doc text with a fictitious `payment.ts` path, or this verification task's own prompt text.

## C5 — Session `56af20da*`, "catch {}" / "17 hits", final tracker
**Verdict: PARTIAL — "catch {}" CONFIRMED, "17 hits" REFUTED**
- Session dir: `/Users/hip/.claude/projects/-Users-hip-repo-todd-skills/56af20da-746d-43ec-9967-0b98d1c9f1e2/`.
- `catch {}` appears in 6 tracker transcripts in that session. The actual HG-candidate block (in `agent-a2e7d7c3454190d80.jsonl`):
  > `**HG-candidate 1 [error-handling]** — bare catch { } blocks that collapse multiple distinct failure modes into one silent sentinel, e.g. plugins/explaining/skills/explaining/scripts/validate-mermaid.ts:180,190,285,314,325. Confirmed via grep -rn "catch {" ... → 10 non-test files / 22 occurrences repo-wide...`
- No transcript in this session contains the literal phrase "17 hits" (checked variants: "17 hits", "17-file", "(17 ", "17 files", "17 occurrences", "= 17", ": 17"). Prevalence counts actually found in this session's transcripts: "10+ files", "10 non-test files / 22 occurrences", and "27" (a raw grep -c count from a different tracker run). **The specific "17 hits" figure does not occur — REFUTED as stated.**
- **Final tracker** (by mtime, `agent-adc57255408f68410.jsonl`) final assistant message:
  > *"Investigated three harness-gap candidates (fire-and-forget async, uncleared `setTimeout`, empty `catch{}`) — all three failed either the ≥3-file prevalence floor or the diff-anchored condition, so none are reported."*
  This confirms the final tracker's Harness gaps section reports **no** candidates.
- `gh pr view 103 --repo hieplam/tribe` body, lines 142–151, matches this exactly:
  > *"### Harness gaps\n\nThe final whole-branch Tracker returned **APPROVE** with a `### Harness gaps` section concluding: 'No candidates survive all four conditions; nothing to surface.'"* … *"No matched ids, no minted ids, 0 suppressed, no flagged fingerprints: with zero qualifying candidates there was nothing for `gap-reconcile.ts` to consume."*

## C6 — Session `5c91125c*`, PR #123 "no .tribe/harness-gaps.jsonl"
**Verdict: CONFIRMED**
- `gh pr view 123 --repo hieplam/tribe --json body`, grep `harness-gaps`:
  > *"This repo has no `.tribe/harness-gaps.jsonl` and no `.c3/documents/debt/`, so there is no registry to reconcile against and no `G-NNN` ids have been minted."*
- Session `5c91125c-780e-4b72-93a7-31ec994dad58` tracker transcript `agent-ad86f7e6c1e139a7d.jsonl` has a genuine HG-candidate:
  > `HG-candidate 1  [error-handling]  diff FOLLOWS an undocumented pattern\n  Pattern: Parse functions signal failure via a discriminated-union return ({error: string} vs. success shape) rather than throwing, with callers narrowing via 'error' in got.`
  (This matches PR #123's own item 4 proposal: *"Discriminated-union parse-failure returns ... are an established convention here with no written rule naming them."*)

## C7 — Session `93fe0a83*`, "harness-gap candidate recorded" / "step-7 reconciliation"
**Verdict: CONFIRMED**
- `harness-gap candidate recorded` and `step-7 reconciliation` both found in **one** warchief subagent transcript, `agent-a73935584fa9a54e0.jsonl`:
  > *"...cleared (zero control bytes, sortKey deleted not patched, pure-core intact). 1 harness-gap candidate recorded for step-7 reconciliation (blanket catch-and-degrade, 5 files/11 hits, clears the prevalence floor). Awaiting both skinner lenses."*
  This is a progress-log line (echoed to a progress file), belonging to a different task in the session (a "feat/clv-a" branch) than the PR the session eventually opened.
- No `gap-reconcile` Bash invocation ran anywhere in this session (main or any of its 144 subagent files) — `grep -o '"command":"[^"]*gap-reconcile[^"]*"'` returned nothing.
- Main-session PR URLs found: `hieplam/todd-skills/pull/{111,113,114,115}`. **Note:** `gh pr view 115 --repo hieplam/todd-skills` resolves to `https://github.com/hieplam/tribe/pull/115` — `todd-skills` is the repo's pre-rename name and gh transparently redirects (consistent with commit `3378e99` "correct the pre-rename README note" seen in this repo's own recent history). PR #115's body ends with `https://claude.ai/code/session_01CZ2Y716x6jwCMoE1PLbrUu`, the same session-link string found inside this session's own subagent transcript (`agent-a024e59d2569f8327.jsonl`), confirming session `93fe0a83` is the one that opened PR #115.
- PR #115's body **does** have a `## Harness gaps` heading:
  > *"The tracker found **no** harness-gap candidates meeting the bar (diff-anchored, risk-scoped, ≥3-file prevalence, no covering rule), so no registry reconciliation was run and no `G-NNN` id was matched or minted. The scout's survey did produce **rule candidates**..."*

## C8 — Session `ae4731e3*` (Kanna)
**Verdict: CONFIRMED**
- Main session transcript ran `gh pr create`:
  > `"command":"cd /Users/hip/repo/kanna-wt-typography && gh pr create --repo cuongtranba/kanna --base main --head feat/typography-scale-preference --title \"..."`
- `gh pr view 825 --repo cuongtranba/kanna --json body,title,url`: title *"feat(typography): user-adjustable typography scale in Settings → General"*. **No `## Harness gaps` heading exists in the body** (headings present: Why, What, Before/after, How this is verified, Notes). The only "harness" mentions are about the Playwright test harness, unrelated to the Tracker/gap-reconcile mechanism.
- Three tracker subagent transcripts in this session carry genuine HG-candidate blocks (see C2 table above for the full ~200-char quotes): `agent-a9894f39a7813efa6.jsonl` (error-handling, forked catch idiom), `agent-af34ff9a051656e4f.jsonl` (test-presence, untested harness helpers), `agent-ac858971df60ed6bc.jsonl` (resource-cleanup, hand-reimplemented SIGTERM/SIGKILL logic).

## C9 — `answers.md` ratified-as lines, commit `036c5cc`
**Verdict: CONFIRMED**
- `~/.tribe/-Users-hip-repo-tribe/campaigns/followups-2026-09-04/answers.md` contains **10** `ratified-as:` lines:
```
4:`ratified-as: <rule <path> | debt <id> | roadmap <ref> | operational | dismissed | pending>` line.
8:ratified-as: roadmap ~/.tribe/-Users-hip-repo-todd-skills/cards/resume-check-host-config-isolation.md
12:ratified-as: roadmap ~/.tribe/-Users-hip-repo-todd-skills/cards/tribe-test-fixture-assertions.md
16:ratified-as: dismissed
20:ratified-as: rule .c3/rules/rule-c3-table-cell-no-pipe.md
24:ratified-as: rule .c3/rules/rule-change-unit-ships-with-code.md
28:ratified-as: rule .c3/rules/rule-bash-strict-mode.md
32:ratified-as: dismissed
36:ratified-as: operational
40:ratified-as: roadmap ~/.tribe/-Users-hip-repo-todd-skills/cards/tribe-test-fixture-assertions.md
```
(Line 4 is the template/legend line, not a real ratification — 9 actual ratifications.)
- `git show --stat 036c5cc` touches exactly 4 files:
```
.c3/rules/rule-bash-strict-mode.md                 |  3 +-
.c3/rules/rule-c3-table-cell-no-pipe.md            | 41 ++++++++++++++++++
.c3/rules/rule-change-unit-ships-with-code.md      | 48 ++++++++++++++++++++++
...26-09-04-fresh-machine-doctor-fixture-design.md |  6 ++-
```
- `.tribe/harness-gaps.jsonl` is **NOT** among the touched files.
- No file under `.c3/documents/debt/` was created — that directory does not even exist (`find` → "No such file or directory").

## C10 — Which proposals from PR #123 / #115 landed as rules
**Verdict: CONFIRMED (partial landing)**
- `grep -rn "discriminated union"` and `"parse-failure"` across `.c3/rules`, `~/.claude/rules`, `plugins/tribe/rules`: **0 matches**. PR #123's item 4 proposal ("Discriminated-union parse-failure returns ... established convention ... no written rule naming them") has **not** landed as a rule.
- `"table cell"` → `.c3/rules/rule-c3-table-cell-no-pipe.md`. `"pipe"` → same file plus `rule-bash-strict-mode.md`. This rule exists and cites **PR #119** as its origin (not #115 or #123) — its "Not This" table explicitly says *"reproduced 2026-09-04, PR #119"*.
- `gh pr view 115 --repo hieplam/tribe --json body`, headings under `## Harness gaps`: no sub-headings, just prose: *"The tracker found no harness-gap candidates... The scout's survey did produce rule candidates ... a fact's body changes only through a change unit; no backticks or angle brackets in a .c3 table cell; never re-derive from a #nNNN; an ADR's Verification table records only what that unit achieved; one unit with N patches when N facts are independent. Those are proposals only..."* — none of PR #115's specific wordings ("no backticks or angle brackets") match `rule-c3-table-cell-no-pipe.md`'s wording ("never contains a `|` character"); they are topically adjacent, not the same landed text.
- `gh pr view 123 --repo hieplam/tribe --json body`, headings under `## Harness gaps`: no sub-headings, a numbered list of 5 proposals (reviewer-may-not-refute-by-comment; fixture-may-not-fabricate-state; workaround-in-fixture-is-a-defect; discriminated-union parse-failure; cross-invocation persisted-state provenance gate). None of these 5 match the two rules that ratification commit `036c5cc` actually created (`rule-c3-table-cell-no-pipe`, `rule-change-unit-ships-with-code`) — those trace to PR #119 (R4) and PR #120 (R5) per `036c5cc`'s own commit message, not #115 or #123.

## C11 — Is `.tribe/` gitignored?
**Verdict: REFUTED (it is NOT gitignored)**
- `/Users/hip/repo/tribe`: `.gitignore` contents are `.c3/c3.db`, `docs/tribe/state/`, `.DS_Store` — no `.tribe` entry. `git check-ignore -v .tribe/harness-gaps.jsonl` → no output, exit code **1** (not ignored).
- `/Users/hip/repo/kanna` (exists locally): same check, `git check-ignore -v .tribe/harness-gaps.jsonl` → no output, exit code **1** (not ignored). Its `.gitignore` has no `.tribe` entry either.

## C12 — `gh pr view 91`
**Verdict: CONFIRMED**
- Title: *"feat(tribe): dispatch Tracker at audit time; make debt burn-down gate unconditional"*
- `mergedAt`: `2026-08-13T03:10:18Z`
- Sentence mentioning `opened` events and `harness-gaps.jsonl`:
  > *"The only `subagent_type` dispatch sites in the plugin were warchief (shaman.md:80) and hunter (warchief.md:225/430). The Warchief's entire step-7 gap duty was conditional on 'the Tracker report under audit' — a report nothing generated. **Empirically: zero `.tribe/harness-gaps.jsonl` `opened` events ever, in any repo.**"*

---

## Summary table

| Claim | Verdict |
|---|---|
| C1 | CONFIRMED |
| C2 | CONFIRMED (118 tracker runs; 101 mention "Harness gaps"; 7 carry a real HG-candidate in the final message — see table) |
| C3 | CONFIRMED (12/43 warchiefs mention gap-reconcile; zero actual invocations, none with `--candidates`) |
| C4 | CONFIRMED (0 "minted": hits; 6 "--registry" hits, all doc/comment text or self-referential, none a real execution) |
| C5 | PARTIAL ("catch {}" confirmed; "17 hits" REFUTED — actual counts are 10+/22/27; final tracker + PR #103 both confirmed "no candidates") |
| C6 | CONFIRMED |
| C7 | CONFIRMED |
| C8 | CONFIRMED |
| C9 | CONFIRMED |
| C10 | CONFIRMED (PR #123's discriminated-union/parse-failure proposal unadopted; table-cell/pipe rule exists but traces to PR #119, not #115/#123) |
| C11 | REFUTED (`.tribe/` is not gitignored in either tribe or kanna) |
| C12 | CONFIRMED |