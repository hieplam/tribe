---
name: mammoth-hunt
description: >-
  Run the Mammoth Hunt — the tribe's FULL delivery chain on ONE feature, task, or bugfix:
  the real warchief agent orchestrates and monitors, hunters implement under strict TDD,
  TWO independent skinners audit by running the proof, a scout surveys the touched code for
  unwritten conventions, and a tracker checks the diff against written rules before commit.
  Trigger whenever the user invokes the tribe on a single piece of work, in ANY phrasing:
  "Mammoth Hunt", "Grand Hunt", "Tribe workflow", "full tribe", "dispatch the tribe",
  "implement/build/fix X with the tribe", or a tribe role assignment such as "you are a
  shaman now" / "you are the warchief now". Use it even when the user names only one of
  these phrases without explaining the process — this skill IS the definition. NOT for
  batch campaigns ("orchestration", "run these N roadmap cards" — that is
  orchestrate-campaign) and NOT for generic parallelism with no tribe reference ("use a
  workflow", "fan out agents" — that is the Workflow tool).
---

# The Mammoth Hunt

A mammoth is not taken by one hunter — the whole party goes, in fixed roles. This skill
is the **binding** between the hunt's name and its exact dispatch procedure, so the owner
can say "run the Mammoth Hunt" and get the same full chain every time, on any phrasing.

You (the invoking session) act as the **owner's delegate at the Shaman position** — the
same authority pattern as `orchestrate-campaign`, but for ONE piece of work instead of a
batch. You make What/Why calls, you dispatch, you verify evidence. You never write
feature code and you never design How.

## The roster — all five roles, every hunt

| Role | Agent | Duty in this hunt |
|---|---|---|
| Orchestrator | `warchief` | Spec + TDD plan, dispatches everyone below, monitors, merges |
| Implementer | `hunter` (1..n) | One task each, strict TDD, reports to the warchief only |
| Done-ness audit | `skinner` × **2, independent** | RUN the proof (tests/build/lint) against the requirement contract |
| Convention survey | `scout` | Sweeps the touched code for unwritten conventions → rule candidates |
| Rules gate | `tracker` | Reviews the diff against every written rule source before commit |

Why the roster is spelled out here: the warchief's own definition makes hunters and the
dual-skinner audit mandatory, but it dispatches the scout only conditionally (harness-gap
adjudication). The owner's contract for a Mammoth Hunt includes the scout and tracker on
**every** hunt — so the dispatch brief below carries them as standing constraints. A hunt
that skips any of the five roles is not a Mammoth Hunt; do not silently downgrade.

## Procedure

1. **Author one idea card** from the user's ask: a measurable goal, a scope fence, and
   any decisions already made in the conversation. If What/Why is genuinely ambiguous,
   ask the owner before dispatching — never let the warchief guess product intent.

2. **Dispatch the real `warchief` agent** (Agent tool, `subagent_type: "warchief"`) with:
   - the idea card,
   - a report-file path,
   - this standing-constraints block, verbatim in the brief:

   > Standing constraints (Mammoth Hunt): audit every deliverable with two independent
   > skinners as your definition requires; additionally dispatch a `scout` survey of the
   > touched files (unwritten conventions, rule candidates) and a `tracker` diff review
   > against written rules before the final commit — both are mandatory for this hunt,
   > not conditional. Include each agent's findings and their dispositions in your report.

3. **Answer NEEDS_DIRECTION yourself** where the conversation already contains the
   answer; escalate to the owner only the irreversible few (data shapes, product
   promises, new permissions, privacy).

4. **Verify before repeating "SHIPPED"**: read the warchief's report and check the
   evidence (test output, diff, PR link) against the idea card's goal yourself. A claim
   without runnable evidence goes back to the warchief, not to the owner. Two of those
   checks are mechanical, not judgment: the PR body carries a `gap-gate v1` stamp whose
   `card=` matches this hunt's card, and `verify-shipped`'s fourth line is green. A missing
   or mismatched stamp means some session opened that PR without the gate — refuse the
   SHIPPED claim and send it back.

   **Then close the harness-gap loop yourself — a hunt has no closing pass.** In a campaign
   the Stage D ratification pass rules on the whole batch; here you are the only ratifier
   there will ever be, so a proposal you leave in the PR body dies there (PR #115's five
   proposals and PR #123's five did exactly that). Read the gate's `open_ids` from
   `<home>/reports/<card>-gap-gate.json` (`<home>` = `$(plugins/tribe/scripts/tribe-home.sh <target-repo>)`, the base tribe home), ratify each of Scout's proposals yourself
   (`rule` / `anti-rule` / `debt` / `dismissed`) — carrying only the escalation-register few
   to the owner — and have **Scout** execute every ratified verdict by running `gap-rule.ts`
   with `--ratified-by shaman` (or `--ratified-by owner`), so the `ruled` events and the
   rule/anti-rule file or debt entity land through the CLI. Never edit a rule file, a debt
   entity, or `.tribe/harness-gaps.jsonl` by hand, and never call the hunt done with a gap
   still open in the registry.

## Forbidden substitutions

The point of a named hunt is that it cannot be quietly replaced. Never:

- use the **Workflow tool** or generic subagents (`general-purpose`, `claude`) in place
  of the tribe agents — even if it looks faster;
- implement or edit feature code in the main session;
- collapse the two skinners into one, or drop the scout/tracker because the change
  "looks small". Small changes are exactly where unwritten conventions leak in.

## Report back to the owner

One short message: the goal, SHIPPED or BLOCKED, the evidence you verified (one line per
proof), and any scout rule candidates worth adopting. Everything longer lives in the
warchief's report file.
