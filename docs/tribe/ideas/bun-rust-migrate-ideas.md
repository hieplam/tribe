# 10 ideas for tribe — drawn from the Bun Zig→Rust rewrite

> Analysis sources: the original article https://bun.com/blog/bun-in-rust (read directly, 3 extraction
> passes from different angles) + the handoff file `bun-rust-migration-analysis-handoff.md`
> (4 turns of claude.ai conversation).
> Tribe's current state is grounded in the plugin's actual files (`plugins/tribe/`), with `file:line`.
>
> The two backbone mechanisms of the Bun project that these ideas revolve around:
> 1. **Cell per work-item** — each unit of work is handled by a stateless 4-role "cell"
>    (1 implementer + 2 adversarial reviewers + 1 fixer), spawned fresh per item, gone when done.
> 2. **Context isolation between reviews** — the implementer sees the original source + plan + its own
>    reasoning; the reviewer sees only the bare diff, is primed with "assume the code is wrong", and the
>    2 reviewers NEVER see each other.
>    Verbatim from the blog: implementer = *"the .zig original, the port plan, its own reasoning"*;
>    reviewer = *"only the diff. told to assume the code is wrong"*.

---

## Idea 1 — Upgrade the single audit into a 4-role cell: 1 Hunter + 2 independent Skinners + 1 Fixer

**What Bun did:** every work-item ran through exactly the pseudocode Jarred printed in the article:
`feedback = await Promise.all([review(result), review(result)])` — **two** independent reviews running
in parallel, then a separate fixer applies. *"1 implementer, 2 or more adversarial reviewers per
implementer."* The recall math: each reviewer misses a bug with probability p → two independent
reviewers miss with ~p² (each catches 70% → the pair catches ~91%).

**Tribe today:** Warchief step 6 dispatches **one** single Skinner per task
(`warchief.md:441-454`), with a fix loop capped at 3 rounds. One reviewer = one sampling run = one set
of blind spots.

**How to apply:** in step 6, dispatch **2 Skinner instances in parallel** (one Task dispatch, 2 tool
uses in the same message so they run concurrently), each in its own context, neither seeing the other's
findings. The Warchief merges findings at the layer above. The extra cost is ~1 Skinner run (model
`sonnet`, cheap) in exchange for a meaningful recall boost on precisely the tribe's most authoritative
gate.

---

## Idea 2 — Absolute context asymmetry: the Skinner must never see the Hunter's reasoning

**What Bun did:** the reviewer sees only the diff — **never the implementer's reasoning** — because
*"the Claude that wrote the code wants the code to get accepted"*: reading the implementer's
self-justification "persuades" the reviewer into letting bugs through. The three real bugs caught
(use-after-free in `Box<uv::Pipe>`, `trunc()` on negative mtimes, eager evaluation in `unwrap_or`) all
compiled cleanly and looked plausible — only a cold context caught them.

**Tribe today:** the Hunter writes a report file full of reasoning (RED proof, explanations, concerns —
`hunter.md:113-124`), and the Warchief holds both that report and the brief when it dispatches the
Skinner. No rule **forbids** the Warchief from including the Hunter's report/reasoning in the Skinner's
dispatch — context leakage is the easy default, not the exception.

**How to apply:** add an explicit rule to both `warchief.md` (step 6) and `skinner.md` (Operating
rules): the Skinner's dispatch may contain **only the contract (spec/plan) + the diff + the repo's
rules** — never the Hunter's report file, the Warchief's narrative about "how careful the Hunter was",
or any story told by the side that wrote the code. The Skinner runs the proof itself and builds its own
understanding. One line of rule, in exchange for sealing exactly the bias channel that Bun identified
as the reason adversarial review exists.

---

## Idea 3 — Decorrelate the 2 reviewers via INPUT asymmetry, not prompt asymmetry

**What Bun did (and its limits):** the blog does not say the 2 reviewers had different lenses — the
default reading is 2 copies of the same prompt, with diversity coming from sampling. The weakness
(dissected in handoff §4.2): same model + same prompt + same input → they share the model's own blind
spots. The stronger design proposed there: **asymmetrize the input** — reviewer A sees the diff + the
reference source (checks translation fidelity); reviewer B sees only the bare diff (reviews the code
like a reviewer with no context). Two different input distributions → two different error
distributions, without the taxonomy risk of hard-assigned lenses.

**Tribe today:** the Skinner always reads the contract fully-first, then looks at the code
(`skinner.md:121-123`). If you merely duplicate the Skinner (Idea 1), both copies share one input
distribution.

**How to apply (layered on Idea 1):** two dispatch modes for the reviewer pair:
- **Skinner A — "contract lens"**: as today — contract + diff + runs the proof (this one keeps the
  authoritative PASS/FAIL verdict, because only it has the contract to check against).
- **Skinner B — "cold lens"**: receives ONLY the diff + the instruction "assume the code is wrong, find
  the reasons it doesn't work" — no spec, no plan. It catches the bug classes that reviewer A gets
  steered past by the contract: language/idiom errors, evaluation order, resource leaks — exactly the
  3 bug classes the blog recounts.
Reviewer B's findings are **hypotheses** feeding the Warchief's adjudication, not a verdict.

---

## Idea 4 — Disagreement between 2 reviewers is a routing signal, not a system fault

**What Bun did:** when suggestions conflicted (in the workflow that generated LIFETIMES.tsv), nothing
was picked arbitrarily — they ran **one more review round** + a human read it by hand. The handoff
distills the routing table: both reviewers flag the same spot → high confidence, fix directly; one
flags, one is silent → a hypothesis for the fixer to weigh; the two flag in opposite directions →
escalate to a layer with more context. Agreement between independent samples = a cheap confidence
measure.

**Tribe today:** this concept doesn't exist — one Skinner, one verdict, FAIL means fix
(`warchief.md:441-454`). If Ideas 1+3 land without a law for merging findings, the Warchief will
improvise a different merge every time.

**How to apply:** add an explicit adjudication table to Warchief step 6:
- Both A and B flag the same location → **Critical by default**, goes straight into the fixer Hunter's
  brief.
- Only one reviewer flags → the fixer Hunter is allowed to adjudicate (see Idea 5) — false positives
  are cheap, let the lower layer filter them.
- A and B conflict head-on (one demands a fix in direction X, the other the opposite) → **do not
  self-reconcile**: run a third review round, or `NEEDS_DIRECTION` if the conflict exposes a spec
  ambiguity.

---

## Idea 5 — The fixer is a distinct role with the authority to DROP claims: "don't make the reviewer right — make its wrongness cheap"

**What Bun did:** the cell has **4 roles** because the fixer is separate from both the implementer and
the reviewers: *"The implementer doesn't review. The reviewer doesn't implement."* A reviewer's output
is a **hypothesis**, not a ruling — the fixer reads it, drops absurd claims; if it fixes wrongly, the
compiler/tests block it. That is what lets the reviewer be aggressive (primed "assume it's wrong")
without the system dying of false positives.

**Tribe today:** the Warchief "feeds Critical/Important findings back to a fixer Hunter"
(`warchief.md:445-446`) — but the fixer Hunter receives its brief as orders to execute; `hunter.md`
gives it no adjudication mandate. Meanwhile the Skinner's verdict is "authoritative — a FAIL must be
fixed, never argued away" — one notch stiffer than Bun's model, which invites fixing per a wrong claim.

**How to apply:** keep "FAIL must be fixed" at the **verdict** level (it must be resolved before PASS),
but the fixer Hunter's brief states clearly: each **finding** is a hypothesis — the fixer must
reproduce a finding before fixing it; if it can't reproduce, it writes "not reproduced + evidence" into
its report instead of fixing blind. The Skinner's re-audit round (already in place) is the referee: if
the Skinner still FAILs with the new evidence, the finding stands; if it PASSes, the finding falls.
This matches principle #3 of handoff §4.4 exactly: invest in the adjudication layer rather than forcing
the reviewer to be perfect.

---

## Idea 6 — A frozen shared artifact per campaign: tribe's own "PORTING.md"

**What Bun did:** before fanning out, it froze the intelligence into artifacts: PORTING.md (3 hours of
conversation → serialized) + LIFETIMES.tsv (a dedicated workflow + 2 adversarial reviews). Three
effects: (a) hundreds of stateless agents make **consistent** decisions — judgment calls become
lookups; (b) global decisions are computed once, up front, instead of each agent guessing from local
context; (c) reviewers get a reference document — style compliance becomes a **checkable** criterion.
Infrastructure bonus: an identical shared prefix for every agent → prompt cache (the Bun run's 72B
cached / 5.9B uncached ≈ 12:1 ratio).

**Tribe today:** it already has idea cards + Standing Constraints (`shaman.md:79-86`) and a spec/plan
per card — but those are **per-card** artifacts. There is no **per-campaign** artifact freezing the
cross-card decisions: naming conventions, test patterns, error-handling style, the rulings that repeat
in the Decision Log.

**How to apply:** add a "forge the codex" step to Shaman Mode 3 (run the campaign): before dispatching the first card of a
multi-card campaign, the Shaman distills from the repo + Decision Log a `docs/tribe/CODEX.md`
(a lookup-friendly format, TSV/markdown table — greppable like LIFETIMES.tsv), puts **the codex itself
through one Skinner review round** (Bun reviewed both PORTING.md and LIFETIMES.tsv before using them),
then freezes it. Every Hunter brief and every Skinner/Tracker dispatch references it. The Tracker gains
one more rule source to read fresh (`tracker.md:29-37` already has the read-rules-from-files mechanism —
just add the path).

---

## Idea 7 — Mechanical work queue: tasks generated by deterministic tools, not by planner prose

**What Bun did:** the work queue was machine output — *"For each crate, run cargo check, group the
output by file and save the errors to a file"* → ~16,000 errors divided among 64 Claudes; in the test
phase: each failing test's stacktrace saved to a file → 1 cell per failure. The queue is produced by a
deterministic tool and agents only consume it → no goal drift, no "forgetting item #1,337".

**Tribe today:** the Warchief's plan is prose written by an LLM and then re-read by an LLM to dispatch
(`warchief.md:363-374`). `validate-plan.sh` already checks the plan's form — but the source of tasks is
still prose. For homogeneous work (fix N test failures, N lint errors, N rule violations), prose is
where drift creeps in.

**How to apply:** add a `scripts/build-queue.sh` next to `validate-plan.sh`: run the repo's proof
command (test suite / lint / build), parse each failure into one line of
`queue.tsv` (id, file, error digest, stacktrace path). New Warchief rule: when a card is of the
"homogeneous fix/repair" kind (regression sweep, lint sweep, coverage sweep), **the plan must point at
queue.tsv** — each line = one task = one cell (Idea 1), instead of the Warchief narrating the list in
prose. This is the kind of work tribe does weekly, not just in a mega-migration.

---

## Idea 8 — Push wave orchestration from prose down into code

**What Bun did:** coordination lived in a **JavaScript workflow script** — loops, branching,
intermediate results live in code, burning 0 model tokens; Claude's context holds only the final
result. The four disadvantages of agent-driven coordination (handoff §2.3, with doc sources): the
context bottleneck → agentic laziness; token cost linear in routing decisions; non-determinism where no
judgment is needed; no reproducibility/resume.

**Tribe today:** Warchief step 5 is ~70 lines of prose describing the wave algorithm (merge each branch
in order, clean up worktrees, re-record the base SHA, create the next wave's worktrees —
`warchief.md:363-433`) that **the LLM must execute by hand, git command by git command**. Tribe is
already halfway there: `heartbeat-check.sh`, `resume-check.sh`, `validate-plan.sh` embody exactly the
"whatever is deterministic goes into code" philosophy.

**How to apply:** write `scripts/integrate-wave.sh <worktree> <branch...>` wrapping the whole
deterministic chain: merge --no-ff in order → remove merged worktrees/branches → print the new SHA as
the next wave's base → exit codes distinguishing "conflict" (so the Warchief can `NEEDS_DIRECTION`
exactly per the current rule). The Warchief keeps only the judgment part: auditing wave results,
adjudicating findings, deciding escalations. ~50 lines of prompt removed, and an entire class of
executed-the-algorithm-wrong errors gone.

---

## Idea 9 — "Persistent policy, ephemeral instance": refresh the Warchief/Shaman context on a cycle

**What Bun did:** the real "Warchief" was Jarred — persistent authority, but **zero coordination
mechanics in his head**; all state lived in files and git. Handoff turn 3 concludes: persistence of
*state* ≠ persistence of the *context window*; a long-lived context that both coordinates and judges is
an accumulating liability — after 50 tasks it is all noise, and at the exact moment the sharpest
judgment is needed, the intelligence is swimming in garbage.

**Tribe today:** the infrastructure for instances to die and be reborn already exists: the state file +
trailers + Decision Log + `resume-check.sh` (`warchief.md:129-193`, `shaman.md:147-149` "Memory is
files, not instances"). But that machinery only triggers on a **crash** — a Warchief surviving 5 waves
still carries 5 waves of noise.

**How to apply:** turn crash-resume into a **deliberate cycle**: new Shaman rule — dispatching a fresh
Warchief **per card** is already the correct default, but add: for a multi-wave card, the Warchief ends
itself after integrating each wave (commit state, write the heartbeat line "wave N integrated,
re-dispatch me") and the Shaman re-dispatches a new Warchief that reads `resume-check.sh` to run wave
N+1. Each awakening: read the old law from files, clean of noise. Near-zero cost since the entire
resume machinery was already built in PR #22 — only the trigger changes from "on death" to "every
wave".

---

## Idea 10 — The meta-loop: "fix the process, don't hand-fix the code" + mechanical tripwires

**What Bun did:** Jarred's own closing line: *"fixing the process that generates the code instead of
hand-fixing the code."* Across 11 days he didn't fix code — on spotting a failure pattern (stub
functions, long justification comments, overlapping git stash) he **edited the workflow prompt/rules**.
And the rules were near-mechanical: *"If you need a paragraph-long comment to justify why the
workaround is OK, the code is wrong — fix the code"*; every git command that isn't
commit-one-file is banned.

**Tribe today:** the Tracker already has exactly half the mechanism: it reads rules fresh on every run,
"when rules are added or edited your review changes with them automatically — with no change to this
agent" (`tracker.md:21-23`). The other half is missing: **nobody has the job of writing a new rule when
a failure pattern repeats** — the lesson dies inside each audit round.

**How to apply:** add a step to Warchief step 6 and to the Shaman's verify-SHIPPED: when the same
failure pattern appears **≥2 times** (2 fix rounds for the same reason, 2 cards with the same FAIL
class), the holder of the matching authority doesn't just fix — it **writes a new checkable tripwire
rule** into the rule source that Tracker/Skinner read (`.claude/rules/` or Idea 6's CODEX.md), e.g.:
"a >3-line comment justifying a workaround = Blocker", "a new stub/`todo!`/`NotImplementedException` in
the diff = Blocker", "a weakened/skipped test = Blocker" (that last one is already a Hunter anti-goal —
`hunter.md:103-104` — but not yet a rule the Tracker can check). The loop closes: pattern → rule →
every subsequent review enforces it automatically → the pattern doesn't recur.

---

## Bonus (beyond the 10, but worth recording): a trial run before fanning out

Bun ported **3 files** as a proof-of-concept, tuned the workflow, and only then scaled to 1,448. For
tribe: when a plan has a wave of ≥3 parallel sub-plans, the Warchief should run **wave 0 = 1
representative task** through the full cell (Hunter → 2 Skinners → Fixer), use the result to tune the
brief template, and only then dispatch the whole wave. The price of one task buys confidence for the
whole campaign.

---

## Priority summary

| # | Idea | Effort | Which Bun mechanism it draws on |
|---|------|--------|--------------------------------|
| 1 | 4-role cell: 2 Skinners in parallel | Low (edit Warchief prompt) | Cell per work-item, p² recall |
| 2 | Ban leaking Hunter reasoning into the Skinner | Very low (1 rule) | Context isolation |
| 3 | Decorrelate via input asymmetry (contract lens / cold lens) | Low | Advanced context isolation |
| 4 | Disagreement routing table | Low | LIFETIMES.tsv's reconcile round |
| 5 | Fixer may drop claims (reproduce-first) | Low | Reviewer wrongness made cheap |
| 6 | Frozen CODEX.md per campaign | Medium | PORTING.md / LIFETIMES.tsv |
| 7 | Mechanical work queue (`build-queue.sh`) | Medium | cargo-check-as-queue |
| 8 | `integrate-wave.sh` — coordination into code | Medium | Workflow-as-code |
| 9 | Ephemeral Warchief per wave | Low (change the resume trigger) | Persistent policy, ephemeral instance |
| 10 | Meta-loop: repeated pattern → new Tracker rule | Low | "Fix the process, not the code" |

Suggested build order: **2 → 1 → 5 → 4** (the adversarial-review cluster — all prompt edits, immediate
gains on audit quality) → **10 → 6** (the rule/artifact cluster) → **7 → 8 → 9** (the script
infrastructure cluster) → 3 (a refinement once 1 is running smoothly).
