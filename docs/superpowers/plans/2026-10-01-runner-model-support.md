# Plan — Runner: run the newest model, and fail closed when a model is unsupported (card `runner-model-support`)

> **For the executing session.** This plan is your only instructions. Its `## Way of work` below
> is the `subagent-per-task` block, copied verbatim from the "Ways of work" section of
> `plugins/tribe/agents/shaman.md` — follow it exactly. Every task ends with a Verify block
> (Goal · Red · Green · Stub check) and a Done section; re-run each Green yourself before starting
> the next task.

**Goal:** a campaign on `claude-opus-5-5` runs its executor session (G1); `doctor.sh --model <id>`
refuses a model the runner's own SDK cannot run, with the model, the API's reason and the fix (G2);
a permanent API error parks the campaign on its first occurrence, naming the `api_error_code`, and
spawns nothing more (G3); the documented recovery resumes the campaign (G4); the orchestrate-campaign
preflight probes every campaign model (G5).

**Architecture:** one leaf pure module (`core/api-error.ts`, the allowlist and its one parser) read
by the runner's result parsing and the watchdog's log-tail parsing; one pure probe module
(`core/model-probe.ts`) behind a new `run.ts probe-model` subcommand that `doctor.sh` relays; three
small decide-table changes (runner turn/pass, watchdog section 4, supervisor rows) plus one new
supervisor row (P5, owner-acknowledged park); the SDK bump; docs and one C3 change-unit. Every
effect stays at the existing edges.

**Card:** `~/.tribe/-Users-home-repos-tribe/cards/runner-model-support.md` (G1–G5; rulings D1–D4)
· **Spec:** `docs/superpowers/specs/2026-10-01-runner-model-support-design.md` · **Base:** `master`
@ `d3edaf0` · **Branch:** `feat/runner-model-support` · **Issue:** hieplam/tribe#207

## Global Constraints

- Implementer: each task goes to one fresh `general-purpose` subagent, as the Way of work block below
  says — never a tribe agent (`hunter`, `warchief`, `skinner`, `tracker`, `scout`).
- Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).
- This plan runs through the campaign harness as a one-card campaign the Shaman launches with
  `orchestrate-campaign` (card, "Way of work for THIS card"; executor model `claude-opus-5`). The
  runner's executor session works on its own card branch in a separate git worktree created from the
  base branch, and runs every command from that worktree's root. The spec and this plan are already
  on the base branch (Stage A lands them). Commits carry no agent co-author line and carry the
  runner's `Campaign:` trailer. Merge with `gh pr merge --merge` (a regular 2-parent merge), on the
  runner's deliver turn.
- `REPORTS` below means the campaign home's `reports/` directory, which the executor's brief names
  (outside the harness: `~/.tribe/-Users-home-repos-tribe/reports`). Set it once per session:
  `export REPORTS=` followed by that path.
- Once per worktree, before Task 1: `cd plugins/tribe/scripts/runner && bun install --frozen-lockfile`
  (the runner's `node_modules` is gitignored). Task 3 changes the lockfile and runs `bun install`
  itself; after Task 3, every `bun install --frozen-lockfile` installs SDK 0.3.286.
- Shell: this machine's interactive shell wraps `grep`, `ls`, `find` and `git diff`; the Green
  commands below use `bash`, `bun` and `python3` where a literal output matters. Done commands run
  under `bash -c`, where every tool is the system one. This machine has no `timeout(1)`; every bound
  here is `perl -e 'alarm …'` or a bun timer.
- **Never touch `~/.tribe/-Users-home-repos-Cabal/`** — a live campaign runs there. Every fixture
  this plan needs is already embedded below, byte for byte.
- **Real-model calls** happen only where a step says so (Task 2 Step 5, Task 3, Task 10 Step 1):
  each is one tiny session through the Claude Code login, never `ANTHROPIC_API_KEY` (P10 — every
  such command runs under `env -u ANTHROPIC_API_KEY`). Every test suite and every Done command is
  hermetic: the executor double replays real captured result lines, and the supervisor's own sessions
  point at `/usr/bin/false` with `--max-spawns 0`.
- Every apply script in this plan refuses (exits non-zero, writes nothing) unless each text it
  replaces matches exactly once. If one refuses, the tree is not what this plan was written against:
  stop and end the turn with `NEEDS_DIRECTION:` naming the script and its message.
- Every new subprocess carries a timeout (`fail-closed-edges.md` obligation 3); every new argument
  parser refuses a flag whose value is missing instead of swallowing the next flag (obligation 1).
- Scope fence (card, binding): IN — `plugins/tribe/scripts/runner/**`, `plugins/tribe/scripts/doctor.sh`,
  new tests under `plugins/tribe/scripts/tests/`, the orchestrate-campaign preflight text, the runner
  README, the C3 rows this makes stale, the evidence file. OUT — the default models; the local
  `claude` binary (D1); any probe in `--dry-run` (D2); overload/quota retry policy; the live Cabal
  campaign home. Historical plans and specs are not rewritten.
- Oracles (`brief-contracts.md`):
  - **Permanent errors** (`core/api-error.ts`): the allowlist is the contract. A listed code that is
    retried is a bug; an unlisted code that is parked is the WORSE bug (a healthy campaign stops). No
    code is added without a real captured result line.
  - **The probe** (`core/model-probe.ts`): a refusal reported `ok` is a bug; `ok` requires
    `subtype: "success"` AND `is_error` not `true` (the 2026-10-01 refusal arrived as `success` +
    `is_error: true`).
  - **The supervisor** (card `supervisor-park-truth`'s oracle, still binding): parking when the disk
    says the park is false is a bug; refusing to resume while a park is still true is by design. A
    present `NEEDS_OWNER.md` is a park still in force; a deleted one is the owner's acknowledgement.

## Adjudication (REFUTED in advance, for the final reviewer)

1. A failure that fails the same way on the base branch — the final review counts only failures the
   base branch does not have. Measured on `master` @ `d3edaf0` while planning: the runner's
   `bun test` fails 2 tests, both `watchdog-integration.test.ts` "G2 — skip when alive" (1368 pass,
   2 fail with the SDK bumped; the same 2 on master). The previous card measured these as well:
   the viewer's `bun test` (6 fail), `test-input-asymmetry.sh`, `test-runner-done-negative.sh`,
   `test-supervisor-park-truth.sh` (3 G2 checks, very slow), `test-review-cell-v3.sh` (does not
   finish in 16 minutes). `c3x check` on master prints 157 `BROKEN_SEAL` lines, all under
   `.c3/changes/**` (inherited; not this card).
2. `core/supervisor/status.test.ts`'s ParkReason list and its count changing from 19 to 20 — Task 6
   adds the 20th reason on purpose.
3. An unknown model id (HTTP 404, no `api_error_code`) still taking the ordinary retry path — by
   design under ruling D3 (spec §7); `doctor.sh --model` refuses it before launch.
4. The supervisor's G5 run-reason substitution still re-reading an `overloaded` or `quota_cap`
   terminal as `session_incomplete` (spec §1, "A defect found on the way") — out of the fence
   (overload/quota retry policy); the Shaman files it as a follow-up. Only `permanent_api_error` is
   exempted here.
5. P5 resuming more park reasons than `session_incomplete` (`quota_cap`, `stalled`, …) — by design
   (spec §3.6): the same stale-terminal defect, bounded to watchdog-terminal parks, one tick per
   start, and the watchdog-run cap.
6. `doctor.sh` exiting 1 in a card worktree because the viewer's `dist/` is not built — environmental;
   G2's exit-0 proof runs on `test-doctor-model.sh`'s provisioned fixture and, after merge, in the
   master checkout.
7. A finding that asks to change the default models, use the local `claude` binary, or probe in
   `--dry-run`: out of the fence; it goes to the Shaman as `NEEDS_DIRECTION`, never into a fix round.

## Way of work

Quoted from the card: "`Executor: subagent-per-task` — Design settled here; about 4–6 build tasks in
order (SDK bump + e2e probe, doctor `--model`, signal capture + watchdog decide, supervisor park +
status text, optional reset/resume fix, skill + README docs); the decide functions are pure and
table-tested, and G3's end-to-end run against a session double catches the cross-component path.
Heavier mode would need: D4 reproducing as a supervisor persistence/state-machine defect that spans
more than one component's state file."

Against the rubric as the section words it (build tasks only): 8 build tasks in order — Tasks 1–8;
Task 9 is phase-end governance and Task 10 is the final review, neither counted. The count is above
the card's estimate because the G3 ratchet tool (Task 1) and the runner's own stop (Task 4) are
separate units, and D4 reproduced (Task 7). D4 did reproduce as a supervisor defect reading two state
files (`supervisor/state.json` and the watchdog's `status.json`); the fix stays inside the supervisor
(one decide row, one startup snapshot, one pure state helper), and the end-to-end tool drives the
real supervisor → watchdog → runner path — whether that still fits this mode is the Shaman's call,
raised with the plan. It runs through the campaign harness as a one-card campaign the Shaman
launches: the runner's executor session is the orchestrating session the block names, one turn per
task, and the runner runs each task's Done commands itself. The block, copied verbatim from the
"Ways of work" section of `plugins/tribe/agents/shaman.md`:

Executor: subagent-per-task

- One fresh `general-purpose` subagent per task, in order: it runs the task's Red and sees the stated failure, builds, runs the Green and matches the literal expected output, runs the Done commands, and commits. Never dispatch a tribe agent (`hunter`, `warchief`, `skinner`) for a task. Under the campaign harness the runner's executor session is the orchestrating session, one turn per task, each turn ended with `TASK_DONE <task-id> <branch>`.
- The orchestrating session re-runs each task's Green itself before starting the next task; a Green that does not reproduce sends the task back.
- The last task is the final review: a fresh `general-purpose` reviewer gets the card, this plan and the branch diff, judges the diff against every goal row and the scope fence of the card, re-runs every task's Green and the end-to-end check, runs the repo's whole test suite — its documented check command, or the list this plan names — and runs any failing test again on the base branch, rates each finding Blocker, Should-fix or Optional (a failure the base branch does not have is at least Should-fix), and ends with `REVIEW: FAIL` when any finding is Should-fix or worse, else `REVIEW: PASS`, plus the findings with their ratings and evidence; a `REVIEW: PASS` that lists a Should-fix or Blocker finding counts as `REVIEW: FAIL`. On `REVIEW: FAIL`, dispatch one fresh fix subagent with the findings, re-run the Verify of every task the fix touches, and review again with a fresh reviewer — at most 2 fix rounds, all inside the review task's turn; still failing, stop and escalate to the Shaman (under the harness: end the turn with `NEEDS_DIRECTION:` and the findings). Write every round's report to disk — under the harness, the campaign home's `reports/` directory.
- Then open the PR (under the harness, on the runner's deliver turn) — its body carries a `## Final review` section with every round's `REVIEW:` line and its findings, in order, read from those reports — wait for every check to conclude green, and merge with `gh pr merge --merge`.

Card-specific post-merge steps. The orchestrating Shaman session runs them, after the runner reports
the card shipped and it has re-verified it (`verify-shipped`, then the SHIPPED gate) — never the
headless executor session. From the updated `master` checkout, and only when no campaign on this
machine has a live runner session (replacing `node_modules` under a starting session can break it):
run `(cd plugins/tribe/scripts/runner && bun install --frozen-lockfile)`, then
`env -u ANTHROPIC_API_KEY bash plugins/tribe/scripts/doctor.sh --model claude-opus-5-5` and expect
exit 0 with `ok    model claude-opus-5-5 runs on the runner's SDK (Claude Code 2.1.286)`. Open the
follow-up issue for Adjudication item 4 (the G5 substitution re-reading `overloaded`/`quota_cap`).

## File map

| File | Task | Change |
| --- | --- | --- |
| `runner/fixtures/executor/result-claude-code-version-too-old.json`, `result-model-not-found-404.json`, `README.md` | 1 | create — real captured result lines and their provenance |
| `runner/adapters/executor-double.adapter.ts` (+ test), `runner/fixtures/executor/session-double.sh` | 1 | a double can replay a real result line (`DOUBLE_MODE=result-line`) |
| `scripts/tests/test-runner-permanent-api-error.sh` | 1 | create — the G3/G4 end-to-end tool (assert, `--only`, `--measure`) |
| `docs/superpowers/evidence/2026-10-01-runner-model-support-g3-baseline.txt` | 1 | create — the G3 baseline, measured before any fix |
| `runner/core/model-probe.ts` (+ test), `runner/adapters/session.adapter.ts`, `runner/adapters/executor-double.adapter.ts`, `runner/cli/main.ts` | 2 | the probe and `run.ts probe-model` |
| `scripts/doctor.sh`, `scripts/tests/test-doctor-model.sh` | 2 | `--model <id>` (repeatable) and its hermetic test |
| `runner/package.json`, `runner/bun.lock`, `runner/core/model-support.e2e.test.ts` | 3 | SDK `^0.3.286`; the G1 end-to-end test (opt-in) |
| `runner/core/api-error.ts` (+ test), `core/session.ts`, `core/loop/turns.ts`, `core/loop/card-actions.ts`, `core/loop/run-loop.ts` (+ session/turns tests) | 4 | the runner stops on a permanent API error |
| `runner/core/watchdog/{signals,model,decide,status,watch-loop}.ts` (+ signals/decide tests) | 5 | `exit(needs_human:permanent_api_error)` with `apiErrorCode` |
| `runner/core/supervisor/{model,loop,decide,status}.ts` (+ decide/status tests) | 6 | `park(permanent_api_error)` naming the code |
| `runner/core/supervisor/{model,decide,state,loop}.ts` (+ decide/loop tests) | 7 | P5: an owner-acknowledged park resumes |
| `skills/orchestrate-campaign/SKILL.md`, `runner/README.md` | 8 | the preflight probes every model (G5); the README |
| `.c3/adr/…`, `.c3/changes/…`, `.c3/c3-2-plugins/c3-215-tribe.md` | 9 | governance — one change-unit |
| — | 10 | the final review |

Short paths: `runner/` is `plugins/tribe/scripts/runner/`, `scripts/` is `plugins/tribe/scripts/`,
`skills/` is `plugins/tribe/skills/`.

### Task 1: The G3 ratchet — a double that replays a real result line, the end-to-end tool, and the baseline

**Files:** create `runner/fixtures/executor/result-claude-code-version-too-old.json`,
`runner/fixtures/executor/result-model-not-found-404.json`, `runner/fixtures/executor/README.md`,
`scripts/tests/test-runner-permanent-api-error.sh`,
`docs/superpowers/evidence/2026-10-01-runner-model-support-g3-baseline.txt`; modify
`runner/adapters/executor-double.adapter.ts`, `runner/adapters/executor-double.adapter.test.ts`,
`runner/fixtures/executor/session-double.sh`.

This task changes no runner behaviour: it builds the measuring tool and measures today's code with
it. The executor double (`TRIBE_RUNNER_SESSION_DOUBLE`) today always yields a `success` result whose
text is the script's stdout; after this task a script that prints a whole real `result` line is
replayed as that exact message, so the runner, watchdog and supervisor read the bytes the
2026-10-01 campaign received.

- [ ] **Step 1: The fixtures — real bytes, byte for byte** (provenance in the README). Write them
  exactly as below; Step 7's Done checks their sha256.

````bash
cat > plugins/tribe/scripts/runner/fixtures/executor/result-claude-code-version-too-old.json <<'JSON'
{"duration_api_ms":0,"stop_reason":"stop_sequence","session_id":"57723619-59b1-43ed-8ad5-53681be24a69","total_cost_usd":0,"usage":{"output_tokens_details":{"thinking_tokens":0},"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":"","iterations":[],"speed":"standard"},"modelUsage":{},"permission_denials":[],"terminal_reason":"api_error","fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","subagent_stats":{"spawned":0,"requested":{"background":0,"foreground":0,"unset":0},"started_in_background":0,"max_depth":0,"spawned_by_subagents":0,"completed":0,"failed":0,"killed":{"parent":0,"user":0,"system":0},"refused":{"depth_limit":0,"concurrency_limit":0,"budget":0},"by_type":{}},"is_error":true,"num_turns":1,"subtype":"success","api_error_status":400,"api_error_code":"claude_code_version_too_old","result":"API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.","type":"result","duration_ms":586,"uuid":"0abc63e6-918e-49e3-857e-c12b186b2512","queued_turn_count":0,"result_index":0}
JSON
cat > plugins/tribe/scripts/runner/fixtures/executor/result-model-not-found-404.json <<'JSON'
{"duration_api_ms":737,"stop_reason":"stop_sequence","session_id":"6778108d-5532-4423-9566-668db9a63d8d","total_cost_usd":0.000944,"usage":{"output_tokens_details":{"thinking_tokens":0},"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":"","iterations":[],"speed":"standard","fallback_credit":null},"modelUsage":{"claude-haiku-4-5-20251001":{"inputTokens":899,"outputTokens":9,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"webSearchRequests":0,"costUSD":0.000944,"contextWindow":200000,"maxOutputTokens":32000,"thinkingTokens":0,"canonicalModel":"claude-haiku-4-5","provider":"firstParty","costBasis":"list"}},"permission_denials":[],"terminal_reason":"api_error","fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","subagent_stats":{"spawned":0,"requested":{"background":0,"foreground":0,"unset":0},"started_in_background":0,"max_depth":0,"spawned_by_subagents":0,"completed":0,"failed":0,"killed":{"parent":0,"user":0,"system":0},"refused":{"depth_limit":0,"concurrency_limit":0,"budget":0},"by_type":{}},"is_error":true,"num_turns":1,"subtype":"success","api_error_status":404,"result":"There's an issue with the selected model (claude-nonexistent-9). It may not exist or you may not have access to it. Run --model to pick a different model.","type":"result","duration_ms":1420,"uuid":"abbc0fa4-cacb-45ca-b0b2-be11c60f2951","queued_turn_count":0,"result_index":0}
JSON
cat > plugins/tribe/scripts/runner/fixtures/executor/README.md <<'MD'
# Executor fixtures — provenance

`fixtures-mirror-reality` (plugins/tribe/rules): these are real bytes, not convenient shapes.

| File | Provenance |
| --- | --- |
| `session-double.sh` | The executor session double (card runner-driver-only, spec §4.12). `DOUBLE_MODE=result-line` prints `$DOUBLE_RESULT_FILE`, which `adapters/executor-double.adapter.ts`'s `doubleResultMessage` passes through as the session's `result` message. |
| `result-claude-code-version-too-old.json` | Byte-for-byte copy of the first `result` line of a REAL session log: campaign `llm-wiki` (repo hieplam/Cabal), run `2026-10-01T14-36-20-603Z-059b`, log `llm-wiki-57723619-59b1-43ed-8ad5-53681be24a69.log`, SDK 0.3.278 (bundled Claude Code 2.1.278), model `claude-opus-5-5`. `subtype: "success"`, `is_error: true`, `api_error_status: 400`, `api_error_code: "claude_code_version_too_old"`. sha256 `1ba5eda29693975fc7f39c0dda4031d962d5ddf750e87c760e4e8dfd8b70b490`. |
| `result-model-not-found-404.json` | The `result` line of a REAL session started 2026-10-01 through the SDK's `query()` (SDK 0.3.286) with the nonexistent model `claude-nonexistent-9`: `is_error: true`, `api_error_status: 404`, and NO `api_error_code` field. sha256 `84c7d4282f112d037a2d27fafcedac2c1fa11798552abf5c062e379725137a19`. |
MD
python3 -c "import hashlib; d='plugins/tribe/scripts/runner/fixtures/executor/'; [print(hashlib.sha256(open(d+f,'rb').read()).hexdigest(), f) for f in ('result-claude-code-version-too-old.json','result-model-not-found-404.json')]"
````

Expected: `1ba5eda29693975fc7f39c0dda4031d962d5ddf750e87c760e4e8dfd8b70b490 result-claude-code-version-too-old.json`
and `84c7d4282f112d037a2d27fafcedac2c1fa11798552abf5c062e379725137a19 result-model-not-found-404.json`.

- [ ] **Step 2: The failing test** — append to the double's suite (its existing assertions stay
  unchanged):

````bash
python3 - <<'PY'
# Task 1 test: appended to the double's suite (its assertions above stay unchanged).
import pathlib, sys
p = pathlib.Path('plugins/tribe/scripts/runner/adapters/executor-double.adapter.test.ts')
s = p.read_text(encoding='utf-8')
for old, new in [
    ("import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';",
     "import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';"),
    ("import { spawnExecutorDouble as spawnExecutorDoubleWithCard } from './executor-double.adapter.ts';",
     "import { doubleResultMessage, spawnExecutorDouble as spawnExecutorDoubleWithCard } from './executor-double.adapter.ts';"),
]:
    if s.count(old) != 1: sys.exit(f'tests-task1: expected 1 match: {old[:60]!r}')
    s = s.replace(old, new)
s += """
describe('doubleResultMessage — a double can replay a REAL result line (card runner-model-support)', () => {
  const tooOld = readFileSync(join(import.meta.dir, '..', 'fixtures', 'executor', 'result-claude-code-version-too-old.json'), 'utf8');
  test('a whole result line on stdout is passed through as the message, under the double\\'s session id', () => {
    const m = doubleResultMessage(tooOld, 'double-1') as Record<string, unknown>;
    expect(m).toMatchObject({ type: 'result', subtype: 'success', is_error: true, api_error_status: 400, api_error_code: 'claude_code_version_too_old', session_id: 'double-1' });
  });
  test('plain text stays the final text of a success result, as before', () => {
    expect(doubleResultMessage('TASK_DONE T1 b\\n', 'd')).toEqual({ type: 'result', subtype: 'success', session_id: 'd', result: 'TASK_DONE T1 b' });
  });
  test('JSON that is not a result message, or not JSON at all, stays plain text', () => {
    expect(doubleResultMessage('{"type":"assistant"}', 'd')).toMatchObject({ result: '{"type":"assistant"}' });
    expect(doubleResultMessage('{not json', 'd')).toMatchObject({ result: '{not json' });
  });
});
"""
p.write_text(s, encoding='utf-8')
print('tests-task1: 1 suite extended')
PY
````

- [ ] **Step 3: Run it red** — `cd plugins/tribe/scripts/runner && bun test adapters/executor-double.adapter.test.ts`
  → `SyntaxError: Export named 'doubleResultMessage' not found`, ` 0 pass`, ` 1 fail`.

- [ ] **Step 4: Build the double's replay**:

````bash
python3 - <<'PY'
# Task 1 apply script: each replacement must match exactly once, or nothing is written.
import pathlib, sys
R = pathlib.Path('plugins/tribe/scripts/runner')
FN = '''
/** The double's stdout, read as the session's `result` message. A double whose LAST stdout line is
 * a whole `result` message (the JSON a real session emits — e.g. the captured
 * `fixtures/executor/result-claude-code-version-too-old.json`) is passed through as that message,
 * so the runner reads exactly the bytes a real session produced; any other stdout is the session's
 * final text, as before. The session id is the double's own, so the log file and the message agree. */
export function doubleResultMessage(stdout: string, sessionId: string): SessionMessage {
  const lastLine = stdout.trim().split('\\n').pop() ?? '';
  if (lastLine.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(lastLine);
      if (parsed !== null && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'result') {
        return { ...(parsed as SessionMessage), session_id: sessionId };
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err; // a line that is not JSON is ordinary final text
    }
  }
  return { type: 'result', subtype: 'success', session_id: sessionId, result: stdout.trim() };
}
'''
EDITS = {
  'adapters/executor-double.adapter.ts': [
    ("    yield { type: 'result', subtype: 'success', session_id: sessionId, result: stdout.trim() };\n",
     "    yield doubleResultMessage(stdout, sessionId);\n"),
  ],
  'fixtures/executor/session-double.sh': [
    ("# premature-shipped | implement), DOUBLE_REPO, DOUBLE_BRANCH, DOUBLE_LOG (optional turn log).\n",
     "# premature-shipped | implement | result-line), DOUBLE_REPO, DOUBLE_BRANCH, DOUBLE_LOG (optional turn log),\n"
     "# DOUBLE_RESULT_FILE (result-line: a captured `result` message to print as the session's result).\n"),
    ('  *) echo "session-double: unknown DOUBLE_MODE',
     '  result-line)\n'
     '    cat "${DOUBLE_RESULT_FILE:?DOUBLE_RESULT_FILE names the captured result line to print}" ;;\n'
     '  *) echo "session-double: unknown DOUBLE_MODE'),
  ],
}
out = {}
for rel, edits in EDITS.items():
    text = (R / rel).read_text(encoding='utf-8')
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            sys.exit(f'apply-task1: {rel}: expected 1 match, found {n}: {old[:70]!r}')
        text = text.replace(old, new)
    out[rel] = text
out['adapters/executor-double.adapter.ts'] += FN
for rel, text in out.items():
    (R / rel).write_text(text, encoding='utf-8')
print('apply-task1: 2 files changed')
PY
````

Expected: `apply-task1: 2 files changed`; then the suite reads ` 7 pass`, ` 0 fail`.

- [ ] **Step 5: The end-to-end tool** — create it exactly as below and make it executable:

````bash
cat > plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh <<'SH'
#!/usr/bin/env bash
# test-runner-permanent-api-error.sh — card runner-model-support (G3, G4): the end-to-end proof
# that a permanent API error stops a campaign on its FIRST occurrence, and that the documented
# recovery (reset-card, delete NEEDS_OWNER.md, re-run supervise) resumes it.
#
# The world is built from nothing (fixtures-mirror-reality rule 2): a bare `origin`, a clone
# holding independent one-task cards (three where the runner's pass is probed, one where the
# campaign is — the shape of the 2026-10-01 incident), and a v2 campaign home under this test's own HOME.
# The REAL run.ts runs every layer — runner, watchdog, supervisor; only the LLM is replaced, by
# the executor double printing the REAL `result` line a 2026-10-01 campaign received
# (runner/fixtures/executor/result-claude-code-version-too-old.json). No session ever reaches the
# real SDK: the supervisor's own one-shot sessions are pointed at a double that always fails,
# and `--max-spawns 0` parks before one could be spawned.
#
# Usage:
#   test-runner-permanent-api-error.sh                 assert every probe (the card's targets)
#   test-runner-permanent-api-error.sh --only NAME     assert one probe: runner | pool | watchdog
#                                                      | supervise | recovery
#   test-runner-permanent-api-error.sh --measure       print the measured numbers, assert nothing
#                                                      (the G3 ratchet: before -> after)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../runner"
RESULT_LINE="$RUNNER/fixtures/executor/result-claude-code-version-too-old.json"
MODE=assert; ONLY=""
case "${1:-}" in
  "") ;;
  --measure) MODE=measure ;;
  --only) ONLY="${2:?--only needs a probe name: runner | pool | watchdog | supervise | recovery}" ;;
  *) echo "usage: test-runner-permanent-api-error.sh [--measure | --only NAME]" >&2; exit 2 ;;
esac
case "$ONLY" in ""|runner|pool|watchdog|supervise|recovery) ;; *) echo "unknown probe: $ONLY" >&2; exit 2 ;; esac
want() { [[ -z "$ONLY" || "$ONLY" == "$1" ]]; }

TMP="$(mktemp -d)"; TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset ANTHROPIC_API_KEY
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
has()   { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (want substring: $3, got: ${2:0:300})"; fi; }
bounded() { perl -e 'alarm shift; exec @ARGV or die "exec: $!"' 300 "$@"; }

# The executor double for every probe: prints the captured result line (DOUBLE_MODE=result-line).
export TRIBE_RUNNER_SESSION_DOUBLE="$RUNNER/fixtures/executor/session-double.sh"
export DOUBLE_MODE=result-line DOUBLE_RESULT_FILE="$RESULT_LINE" DOUBLE_BRANCH=double/pae
# The supervisor's one-shot sessions never reach the real SDK: this double always fails.
export TRIBE_SUPERVISOR_SESSION_DOUBLE=/usr/bin/false

# world <name> <cards> — a fresh repo (bare origin + clone, <cards> independent one-task cards:
# C1, C2, …) and a campaign home under this HOME's tribe root. Sets REPO and H.
world() {
  local base="$TMP/$1" ids=()
  for ((i = 1; i <= $2; i++)); do ids+=("C$i"); done
  git init -q --bare -b master "$base/origin.git"
  git clone -q "$base/origin.git" "$base/repo" 2>/dev/null
  mkdir -p "$base/repo/docs/plans" "$base/repo/docs/specs"
  for c in "${ids[@]}"; do
    printf '# Plan %s\n\n### Task 1: %s\n\n#### Done\n\n```bash\ntest -f never-built-%s\n```\n' "$c" "$c" "$c" > "$base/repo/docs/plans/$c.md"
    printf '# Spec %s\n' "$c" > "$base/repo/docs/specs/$c.md"
  done
  local g=(git -C "$base/repo" -c user.name=fixture -c user.email=fixture@invalid)
  "${g[@]}" add -A; "${g[@]}" commit -q -m start; "${g[@]}" push -q origin master; "${g[@]}" remote set-head origin master
  REPO="$base/repo"
  H="$(bash "$RUNNER/../tribe-home.sh" "$REPO")/campaigns/$1"
  mkdir -p "$H"; : > "$H/answers.md"
  python3 - "$H" "${ids[@]}" <<'PY'
import json, sys
cards = {c: {"status": "staged", "spec": f"docs/specs/{c}.md", "plan": f"docs/plans/{c}.md", "branch": None,
             "baseSha": None, "pr": None, "mergeSha": None, "sessionId": None, "updatedAt": None,
             "tasks": [{"id": "T1", "heading": f"Task 1: {c}"}]} for c in sys.argv[2:]}
json.dump({"v": 2, "campaign": "pae", "mergePolicy": "regular", "sequence": sys.argv[2:],
           "schemaLockPaths": [], "docsOnlyPaths": [], "ownerOnlyEscalations": [], "cards": cards},
          open(sys.argv[1] + "/campaign-state.json", "w"), indent=2)
PY
}
spawns() { grep -c '"event":"spawn"' "$1/supervisor/ledger.jsonl" 2>/dev/null || true; }
park_reason() { sed -n 's/^\*\*Park reason:\*\* //p' "$1/NEEDS_OWNER.md" 2>/dev/null; }
terminal() { python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["terminal"] or {}; print(t.get("reason"), t.get("apiErrorCode"))' "$1/watchdog/status.json" 2>/dev/null; }
supervise() { bounded bun "$RUNNER/run.ts" supervise --repo "$REPO" --model claude-opus-5-5 --home "$H" --poll-seconds 1 --max-spawns 0 > "$TMP/supervise-$1.out" 2>&1 || true; }

if want runner; then
  world runner 3
  bounded bun "$RUNNER/run.ts" --repo "$REPO" --model claude-opus-5-5 --home "$H" --no-viewer > "$TMP/runner.out" 2>&1 || true
  n="$(spawns "$H")"
  if [[ "$MODE" == measure ]]; then echo "runner_serial_spawns=$n"; else check "runner (serial, 3 cards): one spawn, then the pass stops" "$n" "1"; fi
fi

if want pool; then
  world pool 3
  bounded bun "$RUNNER/run.ts" --repo "$REPO" --model claude-opus-5-5 --home "$H" --no-viewer --max-concurrent 2 > "$TMP/pool.out" 2>&1 || true
  n="$(spawns "$H")"
  if [[ "$MODE" == measure ]]; then echo "runner_pool_spawns=$n"; else check "runner (--max-concurrent 2, 3 cards): only the two in-flight cards spawn" "$n" "2"; fi
fi

if want watchdog; then
  world watchdog 1
  bounded bun "$RUNNER/run.ts" watchdog --repo "$REPO" --model claude-opus-5-5 --home "$H" --follow --poll-seconds 1 > "$TMP/watchdog.out" 2>&1 || true
  n="$(spawns "$H")"; t="$(terminal "$H")"
  if [[ "$MODE" == measure ]]; then echo "watchdog_spawns=$n watchdog_terminal=$t"
  else
    check "watchdog: one spawn" "$n" "1"
    check "watchdog: terminal names the permanent API error and its code" "$t" "permanent_api_error claude_code_version_too_old"
  fi
fi

if want supervise || want recovery; then
  world supervise 1
  supervise 1
  n="$(spawns "$H")"; r="$(park_reason "$H")"
  if [[ "$MODE" == measure ]]; then echo "supervise_spawns_before_park=$n park_reason=$r"
  elif want supervise; then
    check "supervise: exactly one spawn before the park" "$n" "1"
    check "supervise: the park reason carries the API error code" "$r" "permanent_api_error (claude_code_version_too_old)"
    has "supervise: NEEDS_OWNER.md names the code in its owner-facing text" "$(cat "$H/NEEDS_OWNER.md" 2>/dev/null)" '`claude_code_version_too_old`'
  fi
  if want recovery; then
    # The owner fixes the cause (here: the double stops failing), then runs the documented recovery.
    export DOUBLE_MODE=do-nothing DOUBLE_REPO="$REPO"
    bun "$RUNNER/run.ts" reset-card --home "$H" --card C1 > /dev/null
    rm -f "$H/NEEDS_OWNER.md"
    before="$(spawns "$H")"; events_before="$(wc -l < "$H/supervisor/events.jsonl")"
    supervise 2
    added=$(( $(spawns "$H") - before ))
    ran_watchdog="$(tail -n +$((events_before + 1)) "$H/supervisor/events.jsonl" | grep -c '"action":"run_watchdog"' || true)"
    if [[ "$MODE" == measure ]]; then echo "recovery_new_spawns=$added recovery_run_watchdog=$ran_watchdog recovery_park_reason=$(park_reason "$H")"
    else
      check "recovery: the re-run supervisor runs a fresh watchdog" "$([[ "$ran_watchdog" -ge 1 ]] && echo yes || echo no)" "yes"
      check "recovery: the campaign reaches a launch (new executor spawns)" "$([[ "$added" -ge 1 ]] && echo yes || echo no)" "yes"
    fi
  fi
fi

[[ "$MODE" == measure ]] && exit 0
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" == "0" ]]; then echo "PAE=PASS"; else echo "PAE=FAIL"; exit 1; fi
SH
chmod +x plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh
````

- [ ] **Step 6: Measure the baseline (today's code) and commit it as evidence**:

````bash
mkdir -p docs/superpowers/evidence
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --measure | tee docs/superpowers/evidence/2026-10-01-runner-model-support-g3-baseline.txt
````

Expected, exactly (measured three times while planning; the supervise line is the 2026-10-01
campaign's own number, 23):

```text
runner_serial_spawns=15
runner_pool_spawns=15
watchdog_spawns=11 watchdog_terminal=session_incomplete None
supervise_spawns_before_park=23 park_reason=session_incomplete
recovery_new_spawns=0 recovery_run_watchdog=0 recovery_park_reason=session_incomplete
```

If any number differs, the tool and this plan disagree about today's code: stop and end the turn
with `NEEDS_DIRECTION:` quoting the output.

#### Verify

- Goal: G3's and G4's ratchet — the committed tool's baseline before any fix (card: "spawns before
  park for that fixture: 23 (Cabal) → 1").
- Red: `cd plugins/tribe/scripts/runner && bun test adapters/executor-double.adapter.test.ts` after
  Step 2 → `SyntaxError: Export named 'doubleResultMessage' not found`, ` 1 fail`; and
  `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --measure` before Step 5 →
  `No such file or directory`, exit 127.
- Green: the suite → ` 7 pass`, ` 0 fail`, exit 0; `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --measure`
  → the five lines above, exit 0.
- Stub check: with the old double (no `doubleResultMessage`) the result line is wrapped as a plain
  `success` text, the runner never sees `is_error`, and the new test's `toMatchObject` on
  `api_error_code` fails; an empty tool prints nothing and the evidence file is empty, which the Done
  check below refuses.

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test adapters/executor-double.adapter.test.ts
python3 -c "import hashlib,sys; d='plugins/tribe/scripts/runner/fixtures/executor/'; h=lambda f: hashlib.sha256(open(d+f,'rb').read()).hexdigest(); sys.exit(0 if h('result-claude-code-version-too-old.json')=='1ba5eda29693975fc7f39c0dda4031d962d5ddf750e87c760e4e8dfd8b70b490' and h('result-model-not-found-404.json')=='84c7d4282f112d037a2d27fafcedac2c1fa11798552abf5c062e379725137a19' else 1)"
python3 -c "import sys; t=open('docs/superpowers/evidence/2026-10-01-runner-model-support-g3-baseline.txt').read().splitlines(); sys.exit(0 if t==['runner_serial_spawns=15','runner_pool_spawns=15','watchdog_spawns=11 watchdog_terminal=session_incomplete None','supervise_spawns_before_park=23 park_reason=session_incomplete','recovery_new_spawns=0 recovery_run_watchdog=0 recovery_park_reason=session_incomplete'] else 1)"
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --measure | python3 -c "import sys; k=[l.split('=')[0] for l in sys.stdin.read().splitlines()]; sys.exit(0 if k==['runner_serial_spawns','runner_pool_spawns','watchdog_spawns','supervise_spawns_before_park','recovery_new_spawns'] else 1)"
```

- [ ] **Step 7: Commit**

```bash
git add plugins/tribe/scripts/runner/fixtures/executor plugins/tribe/scripts/runner/adapters/executor-double.adapter.ts plugins/tribe/scripts/runner/adapters/executor-double.adapter.test.ts plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh docs/superpowers/evidence/2026-10-01-runner-model-support-g3-baseline.txt
git commit -m "test(runner): replay a real result line through the executor double; G3 baseline 23 spawns before park"
```

### Task 2: The model probe — `run.ts probe-model` and `doctor.sh --model <id>`

**Files:** create `runner/core/model-probe.ts`, `runner/core/model-probe.test.ts`,
`scripts/tests/test-doctor-model.sh`; modify `runner/adapters/session.adapter.ts`,
`runner/adapters/executor-double.adapter.ts`, `runner/cli/main.ts`, `scripts/doctor.sh`.

Ruling D2: the probe lives in `doctor.sh --model <id>` (repeatable), never in `--dry-run`. It is the
smallest real session the runner can make with its OWN SDK (one turn, no tools, no settings, a
one-line system prompt — about $0.007 measured), bounded, failing closed with the API's message. The
probe's decisions (what is a refusal, which fix to print) live in the pure `core/model-probe.ts`;
`doctor.sh` only relays its lines. The SDK stays imported only by `adapters/session.adapter.ts`
(`structure.test.ts`).

- [ ] **Step 1: The failing tests** — the pure core's suite, and the doctor's hermetic suite (the
  probe's session is the executor double printing the real captured lines from Task 1):

````bash
cat > plugins/tribe/scripts/runner/core/model-probe.test.ts <<'TS'
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionMessage } from '../ports/ports.ts';
import {
  buildProbeOptions, classifyProbe, parseProbeArgs, PROBE_PROMPT, renderProbeLines, runModelProbe, type ProbeSpawn,
} from './model-probe.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'executor');
const line = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as SessionMessage;
const INIT: SessionMessage = { type: 'system', subtype: 'init', session_id: 's', claude_code_version: '2.1.278' };
const OK_RESULT: SessionMessage = { type: 'result', subtype: 'success', is_error: false, result: 'OK', session_id: 's' };

/** A spawn yielding `messages`, then throwing — the real SDK throws once an error result has been
 * delivered, so a probe that reads past the first result turns a verdict into a crash. */
const spawnOf = (messages: SessionMessage[], seen: Array<Parameters<ProbeSpawn>[0]> = []): ProbeSpawn => (params) => {
  seen.push(params);
  return (async function* () {
    for (const m of messages) yield m;
    throw new Error('Claude Code returned an error result');
  })();
};

describe('classifyProbe — against real captured result lines', () => {
  test('the 2026-10-01 refusal: not ok, the API reason, status 400 and the code', () => {
    expect(classifyProbe('claude-opus-5-5', INIT, line('result-claude-code-version-too-old.json'), null)).toEqual({
      ok: false, model: 'claude-opus-5-5', claudeCodeVersion: '2.1.278', apiErrorStatus: 400, apiErrorCode: 'claude_code_version_too_old',
      reason: "API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.",
    });
  });
  test('an unknown model: not ok, HTTP 404, no code', () => {
    expect(classifyProbe('claude-nonexistent-9', INIT, line('result-model-not-found-404.json'), null))
      .toMatchObject({ ok: false, apiErrorStatus: 404, apiErrorCode: null });
  });
  test('a clean result is ok', () => {
    expect(classifyProbe('m', INIT, OK_RESULT, null)).toEqual({ ok: true, model: 'm', claudeCodeVersion: '2.1.278' });
  });
  test('no result at all is not ok, carrying the failure', () => {
    expect(classifyProbe('m', null, null, 'no result within 120 s')).toMatchObject({ ok: false, reason: 'no result within 120 s' });
  });
});

describe('renderProbeLines — what doctor.sh relays', () => {
  test('a refusal names the model, the API reason, the code, and the SDK fix', () => {
    const lines = renderProbeLines(classifyProbe('claude-opus-5-5', INIT, line('result-claude-code-version-too-old.json'), null));
    expect(lines[0]).toStartWith("refused: model claude-opus-5-5 cannot run on the runner's SDK (Claude Code 2.1.278) — API Error: 400");
    expect(lines[0]).toEndWith('[HTTP 400, api_error_code claude_code_version_too_old]');
    expect(lines[1]).toStartWith('fix: bump @anthropic-ai/claude-agent-sdk');
  });
  test('an unknown model is told to check the id', () => {
    const lines = renderProbeLines(classifyProbe('claude-nonexistent-9', INIT, line('result-model-not-found-404.json'), null));
    expect(lines[1]).toBe('fix: check the model id "claude-nonexistent-9" — the API does not know it, or this login cannot use it');
  });
  test('a pass is one ok line', () => {
    expect(renderProbeLines({ ok: true, model: 'm', claudeCodeVersion: '2.1.286' }))
      .toEqual(["ok: model m runs on the runner's SDK (Claude Code 2.1.286)"]);
  });
});

describe('runModelProbe', () => {
  test('stops at the first result: the SDK throwing afterwards never turns the verdict into a crash', async () => {
    const seen: Array<Parameters<ProbeSpawn>[0]> = [];
    const verdict = await runModelProbe('claude-opus-5-5', '/cwd', spawnOf([INIT, line('result-claude-code-version-too-old.json')], seen), 5_000);
    expect(verdict).toMatchObject({ ok: false, apiErrorCode: 'claude_code_version_too_old' });
    expect(seen[0]?.prompt).toBe(PROBE_PROMPT);
    expect(seen[0]?.options).toMatchObject({ model: 'claude-opus-5-5', cwd: '/cwd', maxTurns: 1, settingSources: [], tools: [] });
  });
  test('a spawn that throws before any result is a refusal, never a throw', async () => {
    const verdict = await runModelProbe('m', '/cwd', spawnOf([]), 5_000);
    expect(verdict).toMatchObject({ ok: false, reason: 'the session failed before a result: Claude Code returned an error result' });
  });
  test('a session that never answers is refused at the timeout, and aborted', async () => {
    let aborted = false;
    const hang: ProbeSpawn = (params) => (async function* () {
      params.options.abortController.signal.addEventListener('abort', () => { aborted = true; });
      yield INIT;
      await new Promise(() => {});
    })();
    const verdict = await runModelProbe('m', '/cwd', hang, 50);
    expect(verdict).toMatchObject({ ok: false, reason: 'no result within 0 s' });
    expect(aborted).toBe(true);
  });
  test('the option block is the small probe block, never the executor\'s', () => {
    const o = buildProbeOptions('m', '/cwd', new AbortController());
    expect(Object.keys(o).sort()).toEqual(['abortController', 'cwd', 'executable', 'maxTurns', 'model', 'settingSources', 'systemPrompt', 'tools']);
  });
});

describe('parseProbeArgs — fail closed', () => {
  test.each([
    [['--model', 'claude-opus-5-5'], { model: 'claude-opus-5-5', timeoutMs: 120_000 }],
    [['--model', 'm', '--timeout-seconds', '30'], { model: 'm', timeoutMs: 30_000 }],
    [[], { error: '--model is required (e.g. --model claude-opus-5-5)' }],
    [['--model'], { error: '--model needs a value' }],
    [['--model', '--timeout-seconds', '30'], { error: '--model needs a value' }],
    [['--timeout-seconds', '5', '--model', 'm'], { error: '--timeout-seconds must be a whole number from 10 to 600, got "5"' }],
    [['--fast'], { error: 'unknown argument: --fast' }],
  ])('%j', (argv, want) => {
    expect(parseProbeArgs(argv as string[])).toEqual(want);
  });
});
TS
cat > plugins/tribe/scripts/tests/test-doctor-model.sh <<'SH'
#!/usr/bin/env bash
# test-doctor-model.sh — card runner-model-support (G2): `doctor.sh --model <id>` proves the
# runner's own SDK can run each model, and refuses one it cannot with the model, the API's own
# reason and the fix. Hermetic: the probe's session is the executor double printing REAL captured
# result lines (runner/fixtures/executor/), so no model is ever called. doctor.sh is COPIED into a
# throwaway scripts/ tree (it resolves its own directory with `pwd -P`); `runner` there is a
# symlink to the real runner, so the probe runs the real `run.ts probe-model`.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$HERE/.." && pwd)"
FIXTURES="$SCRIPTS/runner/fixtures/executor"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi; }
has()   { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (want substring: $3, got: $2)"; fi; }
hasnt() { if [[ "$2" != *"$3"* ]]; then ok "$1"; else bad "$1 (unwanted substring: $3)"; fi; }

# A provisioned scripts/ tree: doctor.sh, the real runner, a built-viewer stub.
mkdir -p "$TMP/scripts/viewer/dist"
cp "$SCRIPTS/doctor.sh" "$TMP/scripts/doctor.sh"
ln -s "$SCRIPTS/runner" "$TMP/scripts/runner"
printf '<!doctype html>\n' > "$TMP/scripts/viewer/dist/index.html"

# Three probe doubles: a clean answer, the real 2026-10-01 refusal, the real unknown-model 404.
printf '#!/usr/bin/env bash\necho OK\n' > "$TMP/ok.sh"
printf '#!/usr/bin/env bash\ncat %q\n' "$FIXTURES/result-claude-code-version-too-old.json" > "$TMP/too-old.sh"
printf '#!/usr/bin/env bash\ncat %q\n' "$FIXTURES/result-model-not-found-404.json" > "$TMP/not-found.sh"
chmod +x "$TMP/ok.sh" "$TMP/too-old.sh" "$TMP/not-found.sh"

doctor() { # doctor DOUBLE ARGS... -> sets OUT and RC
  set +e
  OUT="$(cd "$TMP" && TRIBE_RUNNER_SESSION_DOUBLE="$1" bash "$TMP/scripts/doctor.sh" "${@:2}" 2>&1)"; RC=$?
  set -e
}

doctor "$TMP/ok.sh"
check "no --model: exit 0, as before" "$RC" "0"
hasnt "no --model: no model line" "$OUT" "model "

doctor "$TMP/ok.sh" --model claude-opus-5-5
check "a model the SDK runs: exit 0" "$RC" "0"
has "a model the SDK runs: an ok line naming it" "$OUT" "ok    model claude-opus-5-5 runs on the runner's SDK"

doctor "$TMP/too-old.sh" --model claude-opus-5-5
check "the 2026-10-01 refusal: exit 1" "$RC" "1"
has "the refusal: a MISSING line naming the model" "$OUT" "MISSING model claude-opus-5-5 cannot run on the runner's SDK"
has "the refusal: the API's own reason" "$OUT" "version 2.1.280 or newer is required"
has "the refusal: the code" "$OUT" "api_error_code claude_code_version_too_old"
has "the refusal: the fix names the SDK bump" "$OUT" "-> bump @anthropic-ai/claude-agent-sdk"

doctor "$TMP/not-found.sh" --model claude-nonexistent-9
check "an unknown model: exit 1" "$RC" "1"
has "an unknown model: HTTP 404 and the API's words" "$OUT" "It may not exist or you may not have access to it"
has "an unknown model: the fix says to check the id" "$OUT" '-> check the model id "claude-nonexistent-9"'

doctor "$TMP/too-old.sh" --model a --model b
check "two models, both refused: exit 1" "$RC" "1"
check "two models: one MISSING line each" "$(printf '%s\n' "$OUT" | grep -c '^  MISSING model ')" "2"
has "two models: the summary counts both" "$OUT" "2 prerequisite(s) missing"

doctor "$TMP/ok.sh" --model
check "--model with no id: usage error, exit 2" "$RC" "2"
has "--model with no id: says so" "$OUT" "--model needs a model id"
doctor "$TMP/ok.sh" --model --model
check "--model never swallows the next flag: exit 2" "$RC" "2"
doctor "$TMP/ok.sh" --fast
check "an unknown argument: exit 2" "$RC" "2"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" == "0" ]]; then echo "DOCTOR-MODEL=PASS"; else echo "DOCTOR-MODEL=FAIL"; exit 1; fi
SH
chmod +x plugins/tribe/scripts/tests/test-doctor-model.sh
````

- [ ] **Step 2: Run them red** — `cd plugins/tribe/scripts/runner && bun test core/model-probe.test.ts`
  → `error: Cannot find module './model-probe.ts'`, ` 1 fail`; `bash plugins/tribe/scripts/tests/test-doctor-model.sh | tail -n 2`
  → `3 passed, 16 failed` and `DOCTOR-MODEL=FAIL` (today's doctor ignores `--model` and exits 0).

- [ ] **Step 3: The pure core**:

````bash
cat > plugins/tribe/scripts/runner/core/model-probe.ts <<'TS'
// core/model-probe.ts — "can the runner's own SDK run this model?" (card runner-model-support,
// ruling D2). The smallest real session the runner can make: one turn, no tools, no settings, a
// one-line prompt — so it costs about a cent and answers in seconds. `doctor.sh --model <id>` runs
// it through `run.ts probe-model`; the campaign runner itself never does (dry-run stays zero-LLM).
//
// PURE except the injected spawn and the global timer (the same exception `session.ts` takes):
// the composition root (`cli/main.ts`) wires the real SDK or the executor double in.
import type { SessionMessage } from '../ports/ports.ts';

export const PROBE_PROMPT = 'Reply with the single word OK.';
export const DEFAULT_PROBE_TIMEOUT_MS = 120_000;

/** The probe's own option block — deliberately NOT the executor's pinned one (`session.ts`): no
 * tools, no settings tiers, no hooks, one turn. Model support is decided by the bundled Claude
 * Code version and the model id, and neither depends on those options. */
export interface ProbeSessionOptions {
  model: string;
  cwd: string;
  maxTurns: 1;
  settingSources: [];
  systemPrompt: string;
  tools: [];
  executable: 'bun';
  abortController: AbortController;
}

export type ProbeSpawn = (params: { prompt: string; options: ProbeSessionOptions }) => AsyncIterable<SessionMessage>;

export type ProbeVerdict =
  | { ok: true; model: string; claudeCodeVersion: string | null }
  | {
      ok: false;
      model: string;
      claudeCodeVersion: string | null;
      /** The API's own words when a result arrived, else what went wrong before one did. */
      reason: string;
      apiErrorStatus: number | null;
      apiErrorCode: string | null;
    };

export function buildProbeOptions(model: string, cwd: string, abortController: AbortController): ProbeSessionOptions {
  return {
    model, cwd, maxTurns: 1, settingSources: [], systemPrompt: PROBE_PROMPT, tools: [],
    executable: 'bun', abortController,
  };
}

/** The verdict from what the session produced. `result` is the first `result` message (or null
 * when none arrived); `failure` says why none did. A result is a pass only when it is a success
 * that is not an error — the 2026-10-01 refusal arrived as subtype `success` with `is_error: true`. */
export function classifyProbe(
  model: string, init: SessionMessage | null, result: SessionMessage | null, failure: string | null,
): ProbeVerdict {
  const version = init !== null && typeof init['claude_code_version'] === 'string' ? init['claude_code_version'] : null;
  if (result !== null && result.subtype === 'success' && result['is_error'] !== true) {
    return { ok: true, model, claudeCodeVersion: version };
  }
  if (result === null) {
    return {
      ok: false, model, claudeCodeVersion: version, apiErrorStatus: null, apiErrorCode: null,
      reason: failure ?? 'the session ended without a result message',
    };
  }
  const status = result['api_error_status'];
  const code = result['api_error_code'];
  const text = typeof result.result === 'string' && result.result !== '' ? result.result : `session ended with subtype "${String(result.subtype)}"`;
  return {
    ok: false, model, claudeCodeVersion: version, reason: text,
    apiErrorStatus: typeof status === 'number' ? status : null,
    apiErrorCode: typeof code === 'string' ? code : null,
  };
}

/** What the owner does about a refusal — one line, chosen from the typed facts only. */
export function remedyFor(verdict: Extract<ProbeVerdict, { ok: false }>): string {
  if (verdict.apiErrorCode === 'claude_code_version_too_old') {
    return 'bump @anthropic-ai/claude-agent-sdk in plugins/tribe/scripts/runner/package.json to the latest '
      + '(npm view @anthropic-ai/claude-agent-sdk@latest version), then run bun install in that directory';
  }
  if (verdict.apiErrorStatus === 404) {
    return `check the model id "${verdict.model}" — the API does not know it, or this login cannot use it`;
  }
  if (verdict.apiErrorStatus === null && verdict.apiErrorCode === null) {
    return `re-run when the network and the Claude Code login work: bun plugins/tribe/scripts/runner/run.ts probe-model --model ${verdict.model}`;
  }
  return `the API refused model "${verdict.model}" — read the reason above before starting a campaign on it`;
}

/** The probe's stdout: `ok: …` on a pass; `refused: …` then `fix: …` on a refusal. `doctor.sh`
 * relays these lines as they are. */
export function renderProbeLines(verdict: ProbeVerdict): string[] {
  const version = verdict.claudeCodeVersion === null ? '' : ` (Claude Code ${verdict.claudeCodeVersion})`;
  if (verdict.ok) return [`ok: model ${verdict.model} runs on the runner's SDK${version}`];
  const facts = [
    verdict.apiErrorStatus === null ? null : `HTTP ${verdict.apiErrorStatus}`,
    verdict.apiErrorCode === null ? null : `api_error_code ${verdict.apiErrorCode}`,
  ].filter((f): f is string => f !== null);
  const suffix = facts.length === 0 ? '' : ` [${facts.join(', ')}]`;
  return [
    `refused: model ${verdict.model} cannot run on the runner's SDK${version} — ${verdict.reason}${suffix}`,
    `fix: ${remedyFor(verdict)}`,
  ];
}

/** Runs the probe: stops at the FIRST result message (the SDK throws once an error result has been
 * delivered, so reading on would turn a clean verdict into a crash) and never waits past
 * `timeoutMs` (fail-closed-edges obligation 3). Never throws. */
export async function runModelProbe(model: string, cwd: string, spawn: ProbeSpawn, timeoutMs: number): Promise<ProbeVerdict> {
  const abortController = new AbortController();
  let init: SessionMessage | null = null;
  const consume = async (): Promise<ProbeVerdict> => {
    try {
      for await (const message of spawn({ prompt: PROBE_PROMPT, options: buildProbeOptions(model, cwd, abortController) })) {
        if (message.type === 'system' && message.subtype === 'init') init = message;
        if (message.type === 'result') return classifyProbe(model, init, message, null);
      }
      return classifyProbe(model, init, null, null);
    } catch (err) {
      return classifyProbe(model, init, null, `the session failed before a result: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProbeVerdict>((resolve) => {
    timer = setTimeout(() => {
      abortController.abort();
      resolve(classifyProbe(model, init, null, `no result within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([consume(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `probe-model` argv (after the subcommand word): `--model <id>` (required) and
 * `--timeout-seconds <10..600>` (default 120). A flag missing its value never swallows the next
 * flag as one (fail-closed-edges obligation 1). */
export function parseProbeArgs(argv: string[]): { model: string; timeoutMs: number } | { error: string } {
  let model: string | null = null;
  let timeoutMs = DEFAULT_PROBE_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    if (flag !== '--model' && flag !== '--timeout-seconds') return { error: `unknown argument: ${flag}` };
    if (value === undefined || value === '' || value.startsWith('--')) return { error: `${flag} needs a value` };
    if (flag === '--model') { model = value; continue; }
    if (!/^\d+$/.test(value) || Number(value) < 10 || Number(value) > 600) {
      return { error: `--timeout-seconds must be a whole number from 10 to 600, got "${value}"` };
    }
    timeoutMs = Number(value) * 1000;
  }
  if (model === null) return { error: '--model is required (e.g. --model claude-opus-5-5)' };
  return { model, timeoutMs };
}
TS
````

- [ ] **Step 4: The edges** — the probe's SDK spawn, the subcommand, and `doctor.sh --model`:

````bash
python3 - <<'PY'
# Task 2 apply script: each replacement must match exactly once, or nothing is written.
import pathlib, sys
R = pathlib.Path('plugins/tribe/scripts/runner')
EDITS = {
  'adapters/session.adapter.ts': [
    ("import type { SessionMessage, SpawnSessionParams } from '../core/session.ts';\n",
     "import type { SessionMessage, SpawnSessionParams } from '../core/session.ts';\nimport type { ProbeSessionOptions } from '../core/model-probe.ts';\n"),
  ],
  'adapters/executor-double.adapter.ts': [
    ("  scriptPath: string, homeDir: string, cardId: string, params: SpawnSessionParams, timeoutMs: number = DOUBLE_TIMEOUT_MS,\n",
     "  scriptPath: string, homeDir: string, cardId: string,\n"
     "  // Only the prompt and a resumed session id are read, so the model probe (`run.ts probe-model`,\n"
     "  // whose options are not the executor's pinned block) can use this double too.\n"
     "  params: Pick<SpawnSessionParams, 'prompt'> & { options: { resume?: string } },\n"
     "  timeoutMs: number = DOUBLE_TIMEOUT_MS,\n"),
  ],
  'cli/main.ts': [
    ("  if (argv[0] === 'reset-card') {\n",
     "  // Card runner-model-support (ruling D2): `doctor.sh --model <id>` asks this subcommand whether\n"
     "  // the runner's OWN SDK can run a model — one tiny real session, bounded, never via\n"
     "  // ANTHROPIC_API_KEY (P10). Exit 0 ok, 1 refused, 2 usage error.\n"
     "  if (argv[0] === 'probe-model') {\n"
     "    const parsed = parseProbeArgs(argv.slice(1));\n"
     "    if ('error' in parsed) {\n"
     "      console.error(`probe-model: ${parsed.error}`);\n"
     "      process.exit(2);\n"
     "      return;\n"
     "    }\n"
     "    unsetAnthropicApiKeyEnv();\n"
     "    const probeDouble = executorDoubleScriptPath();\n"
     "    const spawn: ProbeSpawn = probeDouble === null\n"
     "      ? sdkSpawnProbe\n"
     "      : (params) => spawnExecutorDouble(probeDouble, '(model-probe)', 'model-probe', { prompt: params.prompt, options: {} });\n"
     "    const verdict = await runModelProbe(parsed.model, process.cwd(), spawn, parsed.timeoutMs);\n"
     "    for (const line of renderProbeLines(verdict)) console.log(line);\n"
     "    process.exitCode = verdict.ok ? 0 : 1;\n"
     "    return;\n"
     "  }\n\n"
     "  if (argv[0] === 'reset-card') {\n"),
    ("import { sdkSpawnSession } from '../adapters/session.adapter.ts';\n",
     "import { sdkSpawnProbe, sdkSpawnSession } from '../adapters/session.adapter.ts';\n"
     "import { parseProbeArgs, renderProbeLines, runModelProbe, type ProbeSpawn } from '../core/model-probe.ts';\n"),
  ],
}
APPEND = {
  'adapters/session.adapter.ts': '''
/** The model probe's real SDK spawn (`core/model-probe.ts`, card runner-model-support): the same
 * `query()` with the probe's own small option block. Exercised end to end by `run.ts probe-model`. */
export function sdkSpawnProbe(params: { prompt: string; options: ProbeSessionOptions }): AsyncIterable<SessionMessage> {
  return query({ prompt: params.prompt, options: params.options }) as unknown as AsyncIterable<SessionMessage>;
}
''',
}
out = {}
for rel, edits in EDITS.items():
    text = (R / rel).read_text(encoding='utf-8')
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            sys.exit(f'apply-task2: {rel}: expected 1 match, found {n}: {old[:70]!r}')
        text = text.replace(old, new)
    out[rel] = text + APPEND.get(rel, '')
for rel, text in out.items():
    (R / rel).write_text(text, encoding='utf-8')
print('apply-task2: 3 files changed')
PY
python3 - <<'PY'
# Task 4 apply script: each replacement must match exactly once, or nothing is written.
import pathlib, sys
P = pathlib.Path('plugins/tribe/scripts/doctor.sh')
EDITS = [
  ("# Contract:\n#   exit 0  every required prerequisite is present\n#   exit 1  at least one is missing; each is named on stdout with its remedy\n",
   "# Usage: doctor.sh [--model <id>]...\n"
   "#   --model <id>  (repeatable) also prove the runner's OWN SDK can run that model: one tiny real\n"
   "#                 session per model through `run.ts probe-model` (about a cent, a few seconds),\n"
   "#                 never via ANTHROPIC_API_KEY. A refusal names the model, the API's own reason\n"
   "#                 and the fix (card runner-model-support, ruling D2).\n"
   "#\n"
   "# Contract:\n#   exit 0  every required prerequisite is present\n#   exit 1  at least one is missing; each is named on stdout with its remedy\n"
   "#   exit 2  usage error (an unknown argument, or --model without a model id)\n"),
  ("MISSING=0\n",
   "MODELS=()\n"
   "while [ \"$#\" -gt 0 ]; do\n"
   "  case \"$1\" in\n"
   "    --model)\n"
   "      # A missing value never swallows the next flag as a model id (fail-closed-edges obligation 1).\n"
   "      if [ \"$#\" -lt 2 ] || [ -z \"$2\" ] || [ \"${2#-}\" != \"$2\" ]; then\n"
   "        printf 'doctor.sh: --model needs a model id (e.g. --model claude-opus-5-5)\\n' >&2\n"
   "        exit 2\n"
   "      fi\n"
   "      MODELS+=(\"$2\"); shift 2 ;;\n"
   "    *) printf 'doctor.sh: unknown argument: %s (usage: doctor.sh [--model <id>]...)\\n' \"$1\" >&2; exit 2 ;;\n"
   "  esac\n"
   "done\n\n"
   "MISSING=0\n"),
  ("printf '\\n'\nif [ \"$MISSING\" -eq 0 ]; then\n",
   "# --- models: can the runner's OWN SDK run each campaign model? (ruling D2) -----------\n"
   "# One tiny real session per model through the runner's own node_modules, bounded at 180 s\n"
   "# (fail-closed-edges obligation 3). ANTHROPIC_API_KEY is removed for the probe (P10). Every\n"
   "# decision — what counts as a refusal, which fix to print — is made by the probe itself\n"
   "# (core/model-probe.ts); this block only relays its lines.\n"
   "for m in ${MODELS[@]+\"${MODELS[@]}\"}; do\n"
   "  if [ ! -d \"$RUNNER/node_modules\" ] || ! command -v bun >/dev/null 2>&1; then\n"
   "    gap \"model $m — cannot be probed without bun and the runner dependencies (see above)\"\n"
   "    continue\n"
   "  fi\n"
   "  rc=0\n"
   "  out=\"$(env -u ANTHROPIC_API_KEY perl -e 'alarm shift; exec @ARGV or die \"exec: $!\"' 180 \\\n"
   "    bun \"$RUNNER/run.ts\" probe-model --model \"$m\" 2>&1)\" || rc=$?\n"
   "  if [ \"$rc\" -eq 0 ]; then\n"
   "    ok \"$(printf '%s\\n' \"$out\" | sed -n 's/^ok: //p' | head -n 1)\"\n"
   "  elif [ \"$rc\" -eq 1 ]; then\n"
   "    gap \"$(printf '%s\\n' \"$out\" | sed -n 's/^refused: //p' | head -n 1)\"\n"
   "    fix \"$(printf '%s\\n' \"$out\" | sed -n 's/^fix: //p' | head -n 1)\"\n"
   "  else\n"
   "    gap \"model $m — the probe did not finish (exit $rc): $(printf '%s\\n' \"$out\" | tail -n 1)\"\n"
   "    fix \"re-run it alone: bun '$RUNNER/run.ts' probe-model --model $m\"\n"
   "  fi\n"
   "done\n\n"
   "printf '\\n'\nif [ \"$MISSING\" -eq 0 ]; then\n"),
]
text = P.read_text(encoding='utf-8')
for old, new in EDITS:
    n = text.count(old)
    if n != 1:
        sys.exit(f'apply-task4: doctor.sh: expected 1 match, found {n}: {old[:60]!r}')
    text = text.replace(old, new)
P.write_text(text, encoding='utf-8')
print('apply-task4: doctor.sh changed')
PY
````

Expected: `apply-task2: 3 files changed`, `apply-task4: doctor.sh changed`.

- [ ] **Step 5: Green, hermetic and real.** The hermetic suites first, then one real probe on
  today's SDK (0.3.278) — it must REFUSE `claude-opus-5-5` with the API's own reason (this is G2's
  refusal, and Task 3's Red):

```bash
cd plugins/tribe/scripts/runner && bun test core/model-probe.test.ts structure.test.ts 2>&1 | tail -n 4
cd plugins/tribe/scripts/runner && bunx tsc --noEmit; echo "tsc=$?"
bash plugins/tribe/scripts/tests/test-doctor-model.sh | tail -n 2
cd plugins/tribe/scripts/runner && env -u ANTHROPIC_API_KEY bun run.ts probe-model --model claude-opus-5-5; echo "exit=$?"
```

Expected: ` 32 pass`, ` 0 fail`; `tsc=0`; `19 passed, 0 failed` and `DOCTOR-MODEL=PASS`; then

```text
refused: model claude-opus-5-5 cannot run on the runner's SDK (Claude Code 2.1.278) — API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again. [HTTP 400, api_error_code claude_code_version_too_old]
fix: bump @anthropic-ai/claude-agent-sdk in plugins/tribe/scripts/runner/package.json to the latest (npm view @anthropic-ai/claude-agent-sdk@latest version), then run bun install in that directory
exit=1
```

#### Verify

- Goal: G2 — `doctor.sh --model <id>` refuses a model the runner's SDK cannot run, naming the model,
  the API's own reason and the fix; a supported model reports ok; ruling D2 (doctor, not dry-run).
- Red: `bash plugins/tribe/scripts/tests/test-doctor-model.sh | tail -n 2` before Step 3 →
  `3 passed, 16 failed`, `DOCTOR-MODEL=FAIL`; `cd plugins/tribe/scripts/runner && bun test core/model-probe.test.ts`
  → `Cannot find module './model-probe.ts'`.
- Green: Step 5's four commands print exactly what Step 5 lists (` 32 pass`, `tsc=0`,
  `19 passed, 0 failed` / `DOCTOR-MODEL=PASS`, the real `refused:` + `fix:` lines and `exit=1`).
- Stub check: a probe that always reports ok fails the doctor suite's six refusal checks and the
  real run (it would print `ok:` and exit 0 on SDK 0.3.278); a doctor that ignores `--model` (today's)
  fails 16 of the 19 checks.

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test core/model-probe.test.ts structure.test.ts
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
bash plugins/tribe/scripts/tests/test-doctor-model.sh
cd plugins/tribe/scripts/runner && out="$(TRIBE_RUNNER_SESSION_DOUBLE=fixtures/executor/session-double.sh DOUBLE_MODE=result-line DOUBLE_RESULT_FILE=fixtures/executor/result-claude-code-version-too-old.json bun run.ts probe-model --model claude-opus-5-5)"; rc=$?; test "$rc" = 1 && printf '%s\n' "$out" | grep -q 'api_error_code claude_code_version_too_old'
cd plugins/tribe/scripts/runner && bun run.ts probe-model --model; test "$?" = 2
```

- [ ] **Step 6: Commit**

```bash
git add plugins/tribe/scripts/runner/core/model-probe.ts plugins/tribe/scripts/runner/core/model-probe.test.ts plugins/tribe/scripts/runner/adapters/session.adapter.ts plugins/tribe/scripts/runner/adapters/executor-double.adapter.ts plugins/tribe/scripts/runner/cli/main.ts plugins/tribe/scripts/doctor.sh plugins/tribe/scripts/tests/test-doctor-model.sh
git commit -m "feat(runner): probe-model and doctor.sh --model refuse a model the runner's SDK cannot run (G2)"
```

### Task 3: Bump the Agent SDK so the newest model runs

**Files:** modify `runner/package.json`, `runner/bun.lock`; create `runner/core/model-support.e2e.test.ts`.

Ruling D1: bump `@anthropic-ai/claude-agent-sdk` to the latest published (0.3.286, bundled Claude
Code 2.1.286) — never the local `claude` binary. The SDK touches only `adapters/session.adapter.ts`.
G1's oracle is an end-to-end run of the runner's OWN executor spawn path (`runSession` + the real
`sdkSpawnSession` + the pinned options), opt-in like `core/session.e2e.test.ts` (`RUN_SESSION_E2E=1`,
about $0.15, the Claude Code login).

- [ ] **Step 1: The failing end-to-end test**:

````bash
cat > plugins/tribe/scripts/runner/core/model-support.e2e.test.ts <<'TS'
// core/model-support.e2e.test.ts — card runner-model-support, G1: a campaign executor session on
// the newest model runs through the runner's OWN spawn path (`runSession` wired to the real
// `sdkSpawnSession`, the pinned executor options, the runner's own node_modules) and gets a
// non-error result. On SDK 0.3.278 the same session ends `claude_code_version_too_old`.
//
// Opt-in, like core/session.e2e.test.ts: RUN_SESSION_E2E=1 (costs tokens, needs the Claude Code
// login; ANTHROPIC_API_KEY is removed first — the runner's P10 rule). The model is
// RUN_SESSION_E2E_MODEL, default claude-opus-5-5.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { sdkSpawnSession } from '../adapters/session.adapter.ts';
import { runSession, type SessionIO, type SessionMessage } from './session.ts';

const RUN_E2E = process.env.RUN_SESSION_E2E === '1';
const MODEL = process.env.RUN_SESSION_E2E_MODEL ?? 'claude-opus-5-5';
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..');
const BRIEF = 'Do not use any tool. Reply with exactly this one line and nothing else: NEEDS_DIRECTION: model support probe';

describe.skipIf(!RUN_E2E)(`G1 — an executor session on ${MODEL} through the runner's own spawn path`, () => {
  test('the session ends with a non-error result', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const logged: SessionMessage[] = [];
    const io: SessionIO = {
      spawnSession: sdkSpawnSession,
      onSessionStart: () => {},
      appendLog: (_path, line) => { logged.push(JSON.parse(line) as SessionMessage); },
    };
    const result = await runSession(
      { brief: BRIEF },
      { repoRoot: REPO_ROOT, model: MODEL, sessionTimeoutMs: 180_000, logsDir: '/dev/null/unused', card: 'g1', ledgerPath: '/dev/null/unused' },
      io,
    );
    const resultLine = logged.find((m) => m.type === 'result') as Record<string, unknown> | undefined;
    expect({ is_error: resultLine?.['is_error'], api_error_code: resultLine?.['api_error_code'] ?? null })
      .toEqual({ is_error: false, api_error_code: null });
    expect(result.outcome).toBe('needs_direction');
  }, 200_000);
});
TS
````

- [ ] **Step 2: Run it red on SDK 0.3.278 (real model call)** —
  `cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 env -u ANTHROPIC_API_KEY bun test core/model-support.e2e.test.ts`
  → the diff shows `+   "api_error_code": "claude_code_version_too_old",` and `+   "is_error": true,`;
  ` 0 pass`, ` 1 fail`.

- [ ] **Step 3: Bump**:

```bash
python3 - <<'PY'
import pathlib, sys
p = pathlib.Path('plugins/tribe/scripts/runner/package.json')
s = p.read_text(encoding='utf-8')
old = '"@anthropic-ai/claude-agent-sdk": "^0.3.278"'
if s.count(old) != 1: sys.exit('bump: package.json does not pin ^0.3.278 exactly once')
p.write_text(s.replace(old, '"@anthropic-ai/claude-agent-sdk": "^0.3.286"'), encoding='utf-8')
print('bump: package.json now pins ^0.3.286')
PY
cd plugins/tribe/scripts/runner && bun install && bun install --frozen-lockfile
```

Expected: `bump: package.json now pins ^0.3.286`; `bun install` resolves the new version and ends
`Saved lockfile`; the frozen install then reports no changes; `bun.lock` names `@anthropic-ai/claude-agent-sdk@0.3.286`
and no `0.3.278`.

- [ ] **Step 4: Green (real model calls)**:

```bash
cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 env -u ANTHROPIC_API_KEY bun test core/model-support.e2e.test.ts 2>&1 | tail -n 4
cd plugins/tribe/scripts/runner && env -u ANTHROPIC_API_KEY bun run.ts probe-model --model claude-opus-5-5; echo "exit=$?"
cd plugins/tribe/scripts/runner && bunx tsc --noEmit; echo "tsc=$?"
cd plugins/tribe/scripts/runner && bun test structure.test.ts core/session.test.ts core/model-probe.test.ts 2>&1 | tail -n 4
```

Expected: ` 1 pass`, ` 0 fail`; `ok: model claude-opus-5-5 runs on the runner's SDK (Claude Code 2.1.286)`
and `exit=0`; `tsc=0`; ` 78 pass`, ` 0 fail`.

#### Verify

- Goal: G1 — a campaign executor session on `claude-opus-5-5` gets a non-error result through the
  runner's own spawn path and `node_modules` (ruling D1); the G1 ratchet "probe: error → success".
- Red: `cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 env -u ANTHROPIC_API_KEY bun test core/model-support.e2e.test.ts`
  before Step 3 → `is_error: true`, `api_error_code: "claude_code_version_too_old"`, ` 1 fail`
  (measured while planning).
- Green: Step 4 prints ` 1 pass`; the real probe prints the `ok:` line above with `exit=0`.
- Stub check: without the bump the bundled Claude Code is 2.1.278 and the API refuses the model, so
  both the e2e test and the probe fail; the test asserts on the logged `result` line itself, so a
  session that never ran cannot pass it.

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
grep -q '"@anthropic-ai/claude-agent-sdk": "^0.3.286"' plugins/tribe/scripts/runner/package.json
python3 -c "import json,sys; sys.exit(0 if json.load(open('plugins/tribe/scripts/runner/node_modules/@anthropic-ai/claude-agent-sdk/package.json'))['version']=='0.3.286' else 1)"
python3 -c "import sys; t=open('plugins/tribe/scripts/runner/bun.lock').read(); sys.exit(0 if '@anthropic-ai/claude-agent-sdk@0.3.286' in t and '0.3.278' not in t else 1)"
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test structure.test.ts core/session.test.ts core/model-probe.test.ts core/model-support.e2e.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add plugins/tribe/scripts/runner/package.json plugins/tribe/scripts/runner/bun.lock plugins/tribe/scripts/runner/core/model-support.e2e.test.ts
git commit -m "feat(runner): bump @anthropic-ai/claude-agent-sdk to 0.3.286 so claude-opus-5-5 runs (G1)"
```

### Task 4: The runner stops a card on a permanent API error, and starts no further card

**Files:** create `runner/core/api-error.ts`, `runner/core/api-error.test.ts`; modify
`runner/core/session.ts`, `runner/core/loop/turns.ts`, `runner/core/loop/card-actions.ts`,
`runner/core/loop/run-loop.ts`, `runner/core/session.test.ts`, `runner/core/loop/turns.test.ts`.

Ruling D3: a result whose `api_error_code` is on an explicit allowlist is permanent. Today the real
line (`subtype: "success"`, `is_error: true`, no terminal line) becomes outcome `error`, a retryable
`stopped`, two retries, each a resume plus a fresh fallback — 5 spawns per card — and the pass moves
on to the next card (15 spawns for 3 cards, Task 1's baseline). `core/api-error.ts` is the ONE
parser of "is this result a permanent API error" (`rule-one-parser-per-edge-shape`); Task 5's
watchdog calls the same function.

- [ ] **Step 1: The failing tests** — the allowlist's own suite, and one test each appended to the
  session and turn suites (their existing assertions stay unchanged):

````bash
cat > plugins/tribe/scripts/runner/core/api-error.test.ts <<'TS'
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMANENT_API_ERROR_CODES, permanentApiErrorOf } from './api-error.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'executor');
const line = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Record<string, unknown>;

describe('permanentApiErrorOf — against real captured result lines', () => {
  test('the 2026-10-01 campaign result line is a permanent API error, code and status kept', () => {
    expect(permanentApiErrorOf(line('result-claude-code-version-too-old.json'))).toEqual({
      status: 400,
      code: 'claude_code_version_too_old',
      text: "API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.",
    });
  });
  test('an unknown model (HTTP 404, no api_error_code) is not on the allowlist', () => {
    expect(permanentApiErrorOf(line('result-model-not-found-404.json'))).toBe(null);
  });
  test('the allowlist holds exactly the observed code', () => {
    expect([...PERMANENT_API_ERROR_CODES]).toEqual(['claude_code_version_too_old']);
  });
});

describe('permanentApiErrorOf — every other shape is not permanent', () => {
  const tooOld = line('result-claude-code-version-too-old.json');
  test.each([
    ['a successful result', { type: 'result', subtype: 'success', is_error: false, result: 'OK' }],
    ['is_error is not exactly true', { ...tooOld, is_error: 'true' }],
    ['a code that is not on the allowlist', { ...tooOld, api_error_code: 'rate_limit_error' }],
    ['a non-string code', { ...tooOld, api_error_code: 400 }],
    ['not a result message', { ...tooOld, type: 'assistant' }],
  ])('%s -> null', (_name, message) => {
    expect(permanentApiErrorOf(message as Record<string, unknown>)).toBe(null);
  });
});
TS
python3 - <<'PY'
# Task 5 tests: appended to the existing suites (their assertions above stay unchanged).
import pathlib, sys
R = pathlib.Path('plugins/tribe/scripts/runner')
SESSION = '''
describe('runSession — a permanent API error (card runner-model-support, G3)', () => {
  test('the real 2026-10-01 result line -> outcome "error" carrying the permanent API error', async () => {
    const line = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'executor', 'result-claude-code-version-too-old.json'), 'utf8')) as SessionMessage;
    const io = recordingIo();
    io.spawnSession = () => messages([INIT_MESSAGE, { ...line, session_id: 'sess-123' }]);
    const result = await runSession({ brief: 'x' }, fixtureConfig(), io);
    expect(result.outcome).toBe('error');
    expect(result.permanentApiError).toMatchObject({ status: 400, code: 'claude_code_version_too_old' });
  });
  test('an unknown-model 404 (no code) stays an ordinary error, with no permanent API error', async () => {
    const line = JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', 'executor', 'result-model-not-found-404.json'), 'utf8')) as SessionMessage;
    const io = recordingIo();
    io.spawnSession = () => messages([INIT_MESSAGE, { ...line, session_id: 'sess-123' }]);
    const result = await runSession({ brief: 'x' }, fixtureConfig(), io);
    expect(result.outcome).toBe('error');
    expect(result.permanentApiError).toBeUndefined();
  });
});
'''
TURNS = '''
describe('driveCardTurns — a permanent API error stops the card, never retryable (card runner-model-support)', () => {
  test('stopped, retryable false, the code carried and named in the reason', async () => {
    const h = harness([{ outcome: 'error', finalText: 'API Error: 400 ...', permanentApiError: { status: 400, code: 'claude_code_version_too_old', text: 'API Error: 400 ...' } }]);
    const out = await driveCardTurns({ cardId: 'C1', card: h.c, tasks, planPath: 'p', delivery: { baseBranch: 'master', remote: 'origin', repoRoot: '/r' } }, h.deps);
    expect(out).toEqual({
      kind: 'stopped', cardId: 'C1', retryable: false, permanentApiErrorCode: 'claude_code_version_too_old',
      reason: 'session ended on the permanent API error claude_code_version_too_old: API Error: 400 ...',
    });
    expect(h.events).toEqual(['turn:first']);
  });
});
'''
s = (R / 'core/session.test.ts').read_text(encoding='utf-8')
imp = "import { describe, expect, test } from 'bun:test';\n"
if s.count(imp) != 1: sys.exit('tests-task5: session.test.ts import line not found exactly once')
s = s.replace(imp, imp + "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\n") + SESSION
t = (R / 'core/loop/turns.test.ts').read_text(encoding='utf-8') + TURNS
(R / 'core/session.test.ts').write_text(s, encoding='utf-8')
(R / 'core/loop/turns.test.ts').write_text(t, encoding='utf-8')
print('tests-task5: 2 suites extended')
PY
````

- [ ] **Step 2: Run them red** — `cd plugins/tribe/scripts/runner && bun test core/api-error.test.ts`
  → `Cannot find module './api-error.ts'`; `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only runner`
  → `not ok - runner (serial, 3 cards): one spawn, then the pass stops (got: 15, want: 1)`,
  `PAE=FAIL`.

- [ ] **Step 3: Build** — the allowlist module, then the four edits:

````bash
cat > plugins/tribe/scripts/runner/core/api-error.ts <<'TS'
// core/api-error.ts — the ONE parser of "this session ended on a permanent API error"
// (rule-one-parser-per-edge-shape): the runner's own result parsing (`session.ts`) and the
// watchdog's log-tail parsing (`watchdog/signals.ts`) both read a session `result` message, and
// both ask it here, so the two layers can never disagree about which errors are permanent.
//
// PURE (`pure-core.md`): a value in, a value out; imports nothing local.

/** The allowlist (card runner-model-support, ruling D3). An API error whose `api_error_code` is
 * listed here can never succeed on a retry, so the campaign stops on its first occurrence.
 *
 * Oracle: treating a transient error as permanent parks a healthy campaign — the worse error —
 * so a code earns a place here only when a REAL session was seen returning it, and any code not
 * listed keeps the ordinary retry path. Observed codes:
 * - `claude_code_version_too_old` — HTTP 400; the runner's bundled Claude Code is older than the
 *   model requires (captured 2026-10-01: `fixtures/executor/result-claude-code-version-too-old.json`).
 * An unknown model id carries NO code at all (HTTP 404 only, captured 2026-10-01:
 * `fixtures/executor/result-model-not-found-404.json`), so it is not on this list; `doctor.sh
 * --model` refuses it before launch instead. */
export const PERMANENT_API_ERROR_CODES: ReadonlySet<string> = new Set(['claude_code_version_too_old']);

export interface PermanentApiError {
  /** `api_error_status` — the HTTP status, or `null` when the message carries none. */
  status: number | null;
  /** `api_error_code` — always one of `PERMANENT_API_ERROR_CODES`. */
  code: string;
  /** The message's `result` text: the API's own words (e.g. "...version 2.1.280 or newer is required..."). */
  text: string;
}

/** A session `result` message -> the permanent API error it carries, or `null` for every other
 * message: a non-result, a result that is not an error (`is_error` not exactly `true`), or an
 * error whose code is absent or not on the allowlist. */
export function permanentApiErrorOf(message: Record<string, unknown>): PermanentApiError | null {
  if (message['type'] !== 'result' || message['is_error'] !== true) return null;
  const code = message['api_error_code'];
  if (typeof code !== 'string' || !PERMANENT_API_ERROR_CODES.has(code)) return null;
  const status = message['api_error_status'];
  const text = message['result'];
  return {
    status: typeof status === 'number' ? status : null,
    code,
    text: typeof text === 'string' ? text : '',
  };
}
TS
python3 - <<'PY'
# Task 5 apply script: each replacement must match exactly once, or nothing is written.
import pathlib, sys
R = pathlib.Path('plugins/tribe/scripts/runner')
EDITS = {
  'core/session.ts': [
    ("import { buildMergeGateDecision, parseMergeCommand } from './merge-gate.ts';\n",
     "import { buildMergeGateDecision, parseMergeCommand } from './merge-gate.ts';\nimport { permanentApiErrorOf, type PermanentApiError } from './api-error.ts';\n"),
    ("  taskId?: string;\n  branch?: string;\n}\n",
     "  taskId?: string;\n  branch?: string;\n  /** Set only on `error`: the session ended on an API error no retry can fix (`api-error.ts`). */\n  permanentApiError?: PermanentApiError;\n}\n"),
    ("  const finalText = typeof message.result === 'string' ? message.result : '';\n\n  if (message.subtype !== 'success') {",
     "  const finalText = typeof message.result === 'string' ? message.result : '';\n\n  // A permanent API error arrives with subtype `success` and `is_error: true` (the real 2026-10-01\n  // line); it is checked first so it can never be read as an ordinary missing-terminal-line error.\n  const permanentApiError = permanentApiErrorOf(message);\n  if (permanentApiError !== null) {\n    return { outcome: 'error', finalText, permanentApiError };\n  }\n\n  if (message.subtype !== 'success') {"),
  ],
  'core/loop/card-actions.ts': [
    ("      reason: string;\n      retryable: boolean;\n    };\n",
     "      reason: string;\n      retryable: boolean;\n      /** Set when the session ended on a permanent API error (`core/api-error.ts`): never\n       * retryable, and the pass starts no further card (`run-loop.ts`). */\n      permanentApiErrorCode?: string;\n    };\n"),
    ("        if (resumed.outcome !== 'error') return resumed;\n",
     "        // A permanent API error fails every session alike, so a fresh fallback would only spend a\n        // second spawn on the same refusal.\n        if (resumed.outcome !== 'error' || resumed.permanentApiError !== undefined) return resumed;\n"),
  ],
  'core/loop/turns.ts': [
    ("    if (result.outcome === 'error' || result.outcome === 'timeout') {\n      return {\n        kind: 'stopped', cardId: input.cardId,\n        reason: `session ended with outcome \"${result.outcome}\": ${result.finalText}`,\n        retryable: result.outcome === 'error',\n      };\n    }\n",
     "    if (result.permanentApiError !== undefined) {\n      const { code } = result.permanentApiError;\n      return {\n        kind: 'stopped', cardId: input.cardId,\n        reason: `session ended on the permanent API error ${code}: ${result.finalText}`,\n        retryable: false,\n        permanentApiErrorCode: code,\n      };\n    }\n    if (result.outcome === 'error' || result.outcome === 'timeout') {\n      return {\n        kind: 'stopped', cardId: input.cardId,\n        reason: `session ended with outcome \"${result.outcome}\": ${result.finalText}`,\n        retryable: result.outcome === 'error',\n      };\n    }\n"),
  ],
  'core/loop/run-loop.ts': [
    ("function computeExitCode(processed: CardOutcome[]): number {",
     "/** A card stopped on a permanent API error: the same model refuses every card alike, so the pass\n * starts no further card (card runner-model-support, G3 — \"spawns nothing more\"). */\nfunction stoppedOnPermanentApiError(outcome: CardOutcome): boolean {\n  return outcome.kind === 'stopped' && outcome.permanentApiErrorCode !== undefined;\n}\n\nfunction computeExitCode(processed: CardOutcome[]): number {"),
    ("    const { outcome, worked: didWork } = await runCardTurn(ctx, nc);\n    attempted.add(nc.cardId);\n    processed.push(outcome);\n    if (didWork) worked += 1;\n",
     "    const { outcome, worked: didWork } = await runCardTurn(ctx, nc);\n    attempted.add(nc.cardId);\n    processed.push(outcome);\n    if (didWork) worked += 1;\n    if (stoppedOnPermanentApiError(outcome)) break;\n"),
    ("  const active = new Set<Promise<void>>();\n",
     "  const active = new Set<Promise<void>>();\n  // Set once any card stops on a permanent API error: the cards already in flight finish, and no\n  // further card is launched (the serial pass breaks on the same fact).\n  let permanentApiErrorSeen = false;\n"),
    ("        processed.push(result.outcome);\n        if (result.worked) worked += 1;\n      })\n",
     "        processed.push(result.outcome);\n        if (result.worked) worked += 1;\n        if (stoppedOnPermanentApiError(result.outcome)) permanentApiErrorSeen = true;\n      })\n"),
    ("    if (!isStopRequested(stopFilePathOf(resolved), io)) {\n      // Top up to `maxConcurrent` in-flight workers",
     "    if (!permanentApiErrorSeen && !isStopRequested(stopFilePathOf(resolved), io)) {\n      // Top up to `maxConcurrent` in-flight workers"),
  ],
}
plan = {}
for rel, edits in EDITS.items():
    text = (R / rel).read_text(encoding='utf-8')
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            sys.exit(f'apply-task5: {rel}: expected 1 match, found {n}: {old[:70]!r}')
        text = text.replace(old, new)
    plan[rel] = text
for rel, text in plan.items():
    (R / rel).write_text(text, encoding='utf-8')
print('apply-task5: 4 files changed')
PY
````

Expected: `apply-task5: 4 files changed`.

- [ ] **Step 4: Green**:

```bash
cd plugins/tribe/scripts/runner && bun test core/api-error.test.ts core/session.test.ts core/loop/turns.test.ts 2>&1 | tail -n 4
cd plugins/tribe/scripts/runner && bunx tsc --noEmit; echo "tsc=$?"
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only runner | tail -n 3
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only pool | tail -n 3
```

Expected: ` 70 pass`, ` 0 fail`; `tsc=0`; `ok - runner (serial, 3 cards): one spawn, then the pass stops`,
`1 passed, 0 failed`, `PAE=PASS`; `ok - runner (--max-concurrent 2, 3 cards): only the two in-flight cards spawn`,
`1 passed, 0 failed`, `PAE=PASS`.

#### Verify

- Goal: G3 at the runner layer — the first permanent API error stops the card with no retry and no
  fresh fallback, and the pass starts no further card (ratchet: runner pass 15 → 1, pool 15 → 2).
- Red: `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only runner` before
  Step 3 → `(got: 15, want: 1)`, `PAE=FAIL`.
- Green: `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only runner | tail -n 3`
  → `1 passed, 0 failed`, `PAE=PASS` (exit 0); the rest of Step 4 prints exactly the lines listed under it.
- Stub check: an empty `PERMANENT_API_ERROR_CODES` (or a `permanentApiErrorOf` that returns null)
  leaves `retryable: true`, the runner probe reads 15 spawns and the pool 15, and the api-error,
  session and turns tests fail.

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test core/api-error.test.ts core/session.test.ts core/loop/turns.test.ts
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only runner
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only pool
```

- [ ] **Step 5: Commit**

```bash
git add plugins/tribe/scripts/runner/core/api-error.ts plugins/tribe/scripts/runner/core/api-error.test.ts plugins/tribe/scripts/runner/core/session.ts plugins/tribe/scripts/runner/core/session.test.ts plugins/tribe/scripts/runner/core/loop/turns.ts plugins/tribe/scripts/runner/core/loop/turns.test.ts plugins/tribe/scripts/runner/core/loop/card-actions.ts plugins/tribe/scripts/runner/core/loop/run-loop.ts
git commit -m "feat(runner): a permanent API error stops the card at once and the pass starts no further card (G3)"
```

### Task 5: The watchdog exits `permanent_api_error` on the first occurrence

**Files:** modify `runner/core/watchdog/signals.ts`, `runner/core/watchdog/model.ts`,
`runner/core/watchdog/decide.ts`, `runner/core/watchdog/status.ts`, `runner/core/watchdog/watch-loop.ts`,
`runner/core/watchdog/signals.test.ts`, `runner/core/watchdog/decide.test.ts`.

Today `signals.ts` keeps only `is_error` and the overload statuses from the result line, and
`decide.ts` section 4 spends the crash budget, then exits `session_incomplete`. After this task the
LAST result's permanent error (read through `core/api-error.ts`) exits
`needs_human:permanent_api_error` at once, with `apiErrorCode` in `status.json`'s terminal — but only
for a run THIS invocation tracked (`lastExitCodeProvenanced`): a fresh watchdog started after the
owner's fix re-reads the old run's log, and must launch instead of re-parking (Task 7's recovery
depends on it). The new signal field is absent when there is no permanent error, so every existing
`toEqual` assertion on `parseSessionSignals` stays as written.

- [ ] **Step 1: The failing tests** (appended; existing assertions unchanged):

````bash
python3 - <<'PY'
# Task 6 tests: appended to the existing suites (their assertions above stay unchanged).
import pathlib
R = pathlib.Path('plugins/tribe/scripts/runner')
SIGNALS = '''
describe('parseSessionSignals — a permanent API error (card runner-model-support, G3)', () => {
  const EXECUTOR_FIXTURES = join(import.meta.dir, '..', '..', 'fixtures', 'executor');
  const tooOld = readFileSync(join(EXECUTOR_FIXTURES, 'result-claude-code-version-too-old.json'), 'utf8');
  const notFound = readFileSync(join(EXECUTOR_FIXTURES, 'result-model-not-found-404.json'), 'utf8');

  test('the real 2026-10-01 result line is a permanent API error, and neither quota nor overload', () => {
    const got = parseSessionSignals(tooOld);
    expect(got.permanentApiError).toEqual({ status: 400, code: 'claude_code_version_too_old' });
    expect(got.quota).toBe(null);
    expect(got.overload).toBe(null);
    expect(got.lastResultIsError).toBe(true);
  });
  test('an unknown-model 404 carries no code, so no permanent API error', () => {
    expect(parseSessionSignals(notFound).permanentApiError).toBeUndefined();
  });
  test('last result wins: a permanent error followed by a clean result is no longer permanent', () => {
    const clean = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'TASK_DONE T1 b' });
    expect(parseSessionSignals(`${tooOld.trim()}\\n${clean}\\n`).permanentApiError).toBeUndefined();
  });
});
'''
DECIDE = '''
describe('decide — a permanent API error (card runner-model-support, G3)', () => {
  const PERMANENT = { status: 400, code: 'claude_code_version_too_old' };
  test('exit 3 with a permanent API error exits needs_human on the first occurrence, code carried', () => {
    expect(decide(obs({ permanentApiError: PERMANENT }))).toEqual({
      kind: 'exit', status: 'needs_human', reason: 'permanent_api_error', apiErrorCode: 'claude_code_version_too_old',
    });
  });
  test('it outranks quota, overload, a spent crash budget and STOP', () => {
    const o = obs({
      permanentApiError: PERMANENT, quota: { resetsAtEpochS: FUTURE_RESET_S }, overload: { apiErrorStatus: 529 },
      stopFilePresent: true, counters: { ...ZERO, crashRelaunches: 1 },
    });
    expect(encode(decide(o))).toBe('exit:needs_human:permanent_api_error');
  });
  test('a crash with no exit code to read and a permanent API error in its log exits the same way', () => {
    expect(encode(decide(obs({ lastExitCode: null, crashSuspected: true, permanentApiError: PERMANENT }))))
      .toBe('exit:needs_human:permanent_api_error');
  });
  test('an OLDER run\\'s permanent error (not tracked by this invocation) launches a fresh runner', () => {
    expect(encode(decide(obs({ permanentApiError: PERMANENT, lastExitCodeProvenanced: false })))).toBe('launch');
  });
  test('without the signal, exit 3 still spends the crash budget exactly as before', () => {
    expect(encode(decide(obs({ permanentApiError: null })))).toBe('relaunch:crash');
  });
  test('permanent_api_error is a terminal reason', () => {
    expect(TERMINAL_REASONS).toContain('permanent_api_error');
  });
});
'''
s = (R / 'core/watchdog/signals.test.ts').read_text(encoding='utf-8') + SIGNALS
d = (R / 'core/watchdog/decide.test.ts').read_text(encoding='utf-8') + DECIDE
(R / 'core/watchdog/signals.test.ts').write_text(s, encoding='utf-8')
(R / 'core/watchdog/decide.test.ts').write_text(d, encoding='utf-8')
print('tests-task6: 2 suites extended')
PY
````

- [ ] **Step 2: Run them red** — `cd plugins/tribe/scripts/runner && bun test core/watchdog/signals.test.ts core/watchdog/decide.test.ts 2>&1 | tail -n 4`
  → failures in the two new `describe` blocks (`permanentApiError` is `undefined`; `exit:needs_human:permanent_api_error`
  expected, `exit:done:stop_requested` / `relaunch:crash` received); and
  `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only watchdog` →
  `(got: 2, want: 1)`, `(got: session_incomplete None, want: permanent_api_error claude_code_version_too_old)`, `PAE=FAIL`.

- [ ] **Step 3: Build**:

````bash
python3 - <<'PY'
# Task 6 apply script: each replacement must match exactly once, or nothing is written.
import pathlib, sys
R = pathlib.Path('plugins/tribe/scripts/runner')
TERM_OLD = 'terminal: { status: string; reason: string; exitCode: number } | null'
TERM_NEW = 'terminal: { status: string; reason: string; exitCode: number; apiErrorCode?: string } | null'
EDITS = {
  'core/watchdog/signals.ts': [
    ("  overload: { apiErrorStatus: number } | null;\n  lastResultIsError: boolean;\n",
     "  overload: { apiErrorStatus: number } | null;\n  /** Present only when the LAST result in the tail ended on an allowlisted permanent API error\n   * (`../api-error.ts`); absent otherwise, like `finalLineUnparseable` below. */\n  permanentApiError?: { status: number | null; code: string };\n  lastResultIsError: boolean;\n"),
    ("/** 429 is deliberately absent",
     "import { permanentApiErrorOf } from '../api-error.ts';\n\n/** 429 is deliberately absent"),
    ("  let overload: SessionSignals['overload'] = null;\n",
     "  let overload: SessionSignals['overload'] = null;\n  let permanentApiError: SessionSignals['permanentApiError'];\n"),
    ("      lastResultIsError = message['is_error'] === true;\n",
     "      lastResultIsError = message['is_error'] === true;\n      const permanent = permanentApiErrorOf(message);\n      permanentApiError = permanent === null ? undefined : { status: permanent.status, code: permanent.code };\n"),
    ("  return { quota, overload, lastResultIsError, finalLineUnparseable };",
     "  return permanentApiError === undefined\n    ? { quota, overload, lastResultIsError, finalLineUnparseable }\n    : { quota, overload, permanentApiError, lastResultIsError, finalLineUnparseable };"),
  ],
  'core/watchdog/model.ts': [
    ("  'overloaded', 'overload_backoff_pending', 'stalled',\n] as const;",
     "  'overloaded', 'overload_backoff_pending', 'stalled', 'permanent_api_error',\n] as const;"),
    ("  overload: { apiErrorStatus: number } | null;\n  counters: WatchdogCounters;",
     "  overload: { apiErrorStatus: number } | null;\n  /** The run's last session ended on an allowlisted permanent API error (`../api-error.ts`).\n   * Optional so every existing `decide.test.ts` fixture stays as written; absent = none. */\n  permanentApiError?: { status: number | null; code: string } | null;\n  counters: WatchdogCounters;"),
    ("      nextWakeAtMs?: number;\n    };",
     "      nextWakeAtMs?: number;\n      /** Set only on `permanent_api_error`: the `api_error_code` the session ended on. */\n      apiErrorCode?: string;\n    };"),
    (TERM_OLD, TERM_NEW),
  ],
  'core/watchdog/status.ts': [(TERM_OLD, TERM_NEW)],
  'core/watchdog/decide.ts': [
    ("  if (o.lastExitCode === 3 || isUnknownExit || (o.lastExitCode === null && o.crashSuspected)) {\n",
     "  if (o.lastExitCode === 3 || isUnknownExit || (o.lastExitCode === null && o.crashSuspected)) {\n"
     "    // A permanent API error (card runner-model-support, G3): no relaunch can succeed, so the\n"
     "    // watchdog stops on the first occurrence — before quota, overload, crash budget and STOP,\n"
     "    // because it is a terminal fact about the run, not a request to start work (W-P1). Only a run\n"
     "    // THIS invocation tracked counts: an older run's log, read again after the owner fixed the\n"
     "    // cause and relaunched, must launch a fresh runner instead (`lastExitCodeProvenanced`).\n"
     "    const permanent = o.permanentApiError ?? null;\n"
     "    if (permanent !== null && (o.lastExitCodeProvenanced ?? true)) {\n"
     "      return { kind: 'exit', status: 'needs_human', reason: 'permanent_api_error', apiErrorCode: permanent.code };\n"
     "    }\n"),
  ],
  'core/watchdog/watch-loop.ts': [
    ("    overload: signals?.overload ?? null,\n    counters: state.counters,",
     "    overload: signals?.overload ?? null,\n    permanentApiError: signals?.permanentApiError ?? null,\n    counters: state.counters,"),
    ("    overload: signals.overload,\n    finalLineUnparseable:",
     "    overload: signals.overload,\n    permanentApiError: signals.permanentApiError ?? null,\n    finalLineUnparseable:"),
    (TERM_OLD + ",\n    runnerPid: number | null,",
     TERM_NEW + ",\n    runnerPid: number | null,"),
    ("  const terminate = (\n    status: string, reason: string, exitCode: number, runnerPid: number | null = null,\n  ): WatchdogTerminal => {\n    publish('terminal', `exit:${status}:${reason}`, { status, reason, exitCode }, runnerPid);\n    record('exit', { status, reason, exitCode });",
     "  const terminate = (\n    status: string, reason: string, exitCode: number, runnerPid: number | null = null,\n    apiErrorCode?: string,\n  ): WatchdogTerminal => {\n    // `apiErrorCode` is present only on `permanent_api_error`; every other terminal keeps its shape.\n    const detail = apiErrorCode === undefined ? { status, reason, exitCode } : { status, reason, exitCode, apiErrorCode };\n    publish('terminal', `exit:${status}:${reason}`, detail, runnerPid);\n    record('exit', detail);"),
    ("        return terminate(action.status, action.reason, exitCodeOf(action), observation.run?.runnerPid ?? null);",
     "        return terminate(\n          action.status, action.reason, exitCodeOf(action), observation.run?.runnerPid ?? null, action.apiErrorCode,\n        );"),
  ],
}
out = {}
for rel, edits in EDITS.items():
    text = (R / rel).read_text(encoding='utf-8')
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            sys.exit(f'apply-task6: {rel}: expected 1 match, found {n}: {old[:70]!r}')
        text = text.replace(old, new)
    out[rel] = text
for rel, text in out.items():
    (R / rel).write_text(text, encoding='utf-8')
print('apply-task6: 5 files changed')
PY
````

Expected: `apply-task6: 5 files changed`.

- [ ] **Step 4: Green**:

```bash
cd plugins/tribe/scripts/runner && bun test core/watchdog/ 2>&1 | tail -n 4
cd plugins/tribe/scripts/runner && bunx tsc --noEmit; echo "tsc=$?"
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only watchdog | tail -n 4
```

Expected: ` 218 pass`, ` 0 fail`; `tsc=0`; `ok - watchdog: one spawn`,
`ok - watchdog: terminal names the permanent API error and its code`, `2 passed, 0 failed`, `PAE=PASS`.

#### Verify

- Goal: G3 at the watchdog layer — first occurrence exits `permanent_api_error` with the exact code,
  no relaunch (ratchet: watchdog 11 → 1 against Task 1's baseline).
- Red: `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only watchdog` before
  Step 3 → `(got: 2, want: 1)`, `PAE=FAIL`.
- Green: `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only watchdog | tail -n 4`
  → both `ok -` lines, `2 passed, 0 failed`, `PAE=PASS` (exit 0); the rest of Step 4 prints exactly the
  lines listed under it.
- Stub check: a decide row that is never reached (or a signal never set) leaves the crash relaunch
  and the `session_incomplete` terminal — both the decide table and the end-to-end probe fail; a row
  without the provenance gate fails the "OLDER run … launches a fresh runner" test.

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test core/watchdog/
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only watchdog
```

- [ ] **Step 5: Commit**

```bash
git add plugins/tribe/scripts/runner/core/watchdog
git commit -m "feat(watchdog): exit permanent_api_error with the api_error_code on the first occurrence (G3)"
```

### Task 6: The supervisor parks `permanent_api_error` at once, naming the code

**Files:** modify `runner/core/supervisor/model.ts`, `runner/core/supervisor/loop.ts`,
`runner/core/supervisor/decide.ts`, `runner/core/supervisor/status.ts`,
`runner/core/supervisor/decide.test.ts`, `runner/core/supervisor/status.test.ts`.

Two things stand between the watchdog's new terminal and a park today. (1) No row knows
`permanent_api_error`. (2) The G5 rule replaces the watchdog's terminal reason with the run's own
`run.json` reason whenever the terminal's own run has finalised — and a permanent error's run ends
`session_incomplete` — so the supervisor re-runs the watchdog until `--max-watchdog-runs` (20 spawns,
measured). This task adds the `permanent_api_error` park (no retrigger), reads `apiErrorCode` from
the watchdog's `status.json` (a string or nothing — fail closed), exempts a `permanent_api_error`
terminal about the watchdog's OWN run from the G5 substitution (a newer finalised run still
substitutes, as before), and renders the code into `NEEDS_OWNER.md` from the typed fact. The
ParkReason count in `status.test.ts` moves from 19 to 20 on purpose (Adjudication item 2).

- [ ] **Step 1: The failing tests**:

````bash
python3 - <<'PY'
# Task 7 tests. The only existing assertion that changes is status.test.ts's ParkReason count
# (19 -> 20) and its list, because this task adds the 20th reason on purpose.
import pathlib, sys
R = pathlib.Path('plugins/tribe/scripts/runner')
DECIDE = '''
describe('decide — a permanent API error parks on the first occurrence (card runner-model-support, G3)', () => {
  const RUN = '2026-10-01T14-36-20-603Z-059b';
  const permanent = (over: Partial<SupervisorObservation> = {}) => base({
    lastWatchdog: { terminal: { status: 'needs_human', reason: 'permanent_api_error', exitCode: 10, apiErrorCode: 'claude_code_version_too_old' }, ownedExitCode: 10 },
    watchdogRunId: RUN,
    runs: [{ runId: RUN, pid: 9, alive: false, endedAt: '2026-10-01T14:36:35.265Z', exitCode: 3, reason: 'session_incomplete' }],
    ...over,
  });
  test('parks permanent_api_error at once, naming the code — no retrigger', () => {
    expect(decide(permanent())).toEqual({
      kind: 'park', reason: 'permanent_api_error',
      detail: 'the executor session ended on the permanent API error claude_code_version_too_old; no retry can succeed',
    });
  });
  test('the run\\'s own finalised reason (session_incomplete) never replaces the verdict about that same run', () => {
    expect(decide(permanent({ state: { ...base().state, watchdogRuns: 1 } })).kind).toBe('park');
  });
  test('a NEWER run that finalised after the terminal still decides from its own reason, as before', () => {
    const newer = permanent({
      runs: [
        { runId: RUN, pid: 9, alive: false, endedAt: '2026-10-01T14:36:35.265Z', exitCode: 3, reason: 'session_incomplete' },
        { runId: '2026-10-01T15-00-00-000Z-aaaa', pid: 10, alive: false, endedAt: '2026-10-01T15:01:00.000Z', exitCode: 0, reason: 'done' },
      ],
    });
    expect(decide(newer)).toEqual({ kind: 'spawn_session', session: 'closing', cardId: null });
  });
});
'''
STATUS_RENDER = '''
describe('renderNeedsOwner — a permanent API error names its code (card runner-model-support, G3)', () => {
  test('the park reason line and "What happened" both carry the api_error_code', () => {
    const doc = renderNeedsOwner(needsOwnerInput({
      reason: 'permanent_api_error', cardId: null, question: null, apiErrorCode: 'claude_code_version_too_old',
    }));
    expect(doc).toContain('**Park reason:** permanent_api_error (claude_code_version_too_old)');
    expect(doc).toContain('API error code: `claude_code_version_too_old`');
    expect(doc).toContain('doctor.sh --model');
  });
  test('every other park renders exactly as before (no code line)', () => {
    const doc = renderNeedsOwner(needsOwnerInput());
    expect(doc).toContain('**Park reason:** owner_only\\n');
    expect(doc).not.toContain('API error code');
  });
});
'''
d = (R / 'core/supervisor/decide.test.ts').read_text(encoding='utf-8')
if "import { describe, expect, test } from 'bun:test';" not in d:
    d = d.replace("import { expect, test } from 'bun:test';", "import { describe, expect, test } from 'bun:test';", 1)
d += DECIDE
s = (R / 'core/supervisor/status.test.ts').read_text(encoding='utf-8')
for old, new in [
    ("  'watchdog_no_terminal', 'watchdog_usage', 'resume_blocked', 'history_rewritten',\n];",
     "  'watchdog_no_terminal', 'watchdog_usage', 'resume_blocked', 'history_rewritten',\n  'permanent_api_error',\n];"),
    ("    test('all 19 values are covered by this table (model.ts is the source of truth)', () => {\n      expect(ALL_PARK_REASONS.length).toBe(19);",
     "    test('all 20 values are covered by this table (model.ts is the source of truth)', () => {\n      expect(ALL_PARK_REASONS.length).toBe(20);"),
]:
    if s.count(old) != 1: sys.exit(f'tests-task7: status.test.ts: expected 1 match: {old[:60]!r}')
    s = s.replace(old, new)
s += STATUS_RENDER
(R / 'core/supervisor/decide.test.ts').write_text(d, encoding='utf-8')
(R / 'core/supervisor/status.test.ts').write_text(s, encoding='utf-8')
print('tests-task7: 2 suites extended')
PY
````

- [ ] **Step 2: Run them red** — `cd plugins/tribe/scripts/runner && bun test core/supervisor/decide.test.ts core/supervisor/status.test.ts 2>&1 | tail -n 4`
  → failures in the new blocks (and `tsc` reports `'permanent_api_error'` is not a `ParkReason`);
  `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only supervise` →
  `(got: 20, want: 1)`, `(got: session_incomplete, want: permanent_api_error (claude_code_version_too_old))`, `PAE=FAIL`.

- [ ] **Step 3: Build**:

````bash
python3 - <<'PY'
# Task 7 apply script: each replacement must match exactly once, or nothing is written.
import pathlib, sys
R = pathlib.Path('plugins/tribe/scripts/runner')
TERM_OLD = 'terminal: { status: string; reason: string; exitCode: number } | null;'
TERM_NEW = 'terminal: { status: string; reason: string; exitCode: number; apiErrorCode?: string } | null;'
EDITS = {
  'core/supervisor/model.ts': [
    ("  | 'resume_blocked'\n  | 'history_rewritten';",
     "  | 'resume_blocked'\n  | 'history_rewritten'\n  /** Card runner-model-support (G3): the executor session ended on a permanent API error\n   * (the watchdog's `permanent_api_error` terminal) — parked on the first occurrence, no retrigger. */\n  | 'permanent_api_error';"),
    ("  lastWatchdog: {\n    " + TERM_OLD,
     "  lastWatchdog: {\n    /** `apiErrorCode` is present only on a `permanent_api_error` terminal. */\n    " + TERM_NEW),
  ],
  'core/supervisor/loop.ts': [
    ("  runId: string | null;\n  " + TERM_OLD + "\n}",
     "  runId: string | null;\n  " + TERM_NEW + "\n}"),
    ("      terminal = { status: t['status'], reason: t['reason'], exitCode: t['exitCode'] };\n",
     "      terminal = { status: t['status'], reason: t['reason'], exitCode: t['exitCode'] };\n      // Only a string code is read; anything else leaves the field absent (fail closed).\n      if (typeof t['apiErrorCode'] === 'string') terminal.apiErrorCode = t['apiErrorCode'];\n"),
    ("          lastWatchdogTerminalReason: observation.lastWatchdog?.terminal?.reason ?? null,\n          ledgerLines:",
     "          lastWatchdogTerminalReason: observation.lastWatchdog?.terminal?.reason ?? null,\n          apiErrorCode: action.reason === 'permanent_api_error'\n            ? observation.lastWatchdog?.terminal?.apiErrorCode ?? null\n            : null,\n          ledgerLines:"),
  ],
  'core/supervisor/decide.ts': [
    ("      reason = terminalReasonForRunReason(contradiction.reason) ?? reason;\n",
     "      //\n"
     "      // Except a `permanent_api_error` terminal about that SAME run: it is the watchdog's verdict on\n"
     "      // how that run ended, read from the session's own result line — a fact run.json's reason\n"
     "      // (`session_incomplete`) cannot express — so it is never replaced by it (card\n"
     "      // runner-model-support, G3).\n"
     "      const ownRunVerdict = reason === 'permanent_api_error' && contradiction.runId === o.watchdogRunId;\n"
     "      if (!ownRunVerdict) reason = terminalReasonForRunReason(contradiction.reason) ?? reason;\n"),
    ("  if (reason === 'error') return park('error', 'the watchdog reported an unrecoverable error');\n",
     "  if (reason === 'error') return park('error', 'the watchdog reported an unrecoverable error');\n"
     "  // Card runner-model-support (G3): a permanent API error parks on the FIRST occurrence — no\n"
     "  // retrigger, because no new session can succeed until the owner fixes the cause.\n"
     "  if (reason === 'permanent_api_error') {\n"
     "    return park('permanent_api_error', 'the executor session ended on the permanent API error '\n"
     "      + `${w.terminal?.apiErrorCode ?? '(no api_error_code recorded)'}; no retry can succeed`);\n"
     "  }\n"),
  ],
  'core/supervisor/status.ts': [
    ("  history_rewritten: {\n",
     "  permanent_api_error: {\n"
     "    what: 'An executor session ended on a permanent API error — one that no retry can fix. The '\n"
     "      + 'supervisor parked on the first occurrence and spawned nothing more.',\n"
     "    unblock: 'Fix the cause the API error code names (for claude_code_version_too_old: bump '\n"
     "      + '@anthropic-ai/claude-agent-sdk in the runner\\'s package.json to the latest version and run bun '\n"
     "      + 'install in the runner directory), confirm it with doctor.sh --model <model>, reset each '\n"
     "      + 'stopped card with run.ts reset-card --home {home} --card <card>, delete this file, then '\n"
     "      + 're-run: {rerun}',\n"
     "  },\n"
     "  history_rewritten: {\n"),
    ("  lastWatchdogTerminalReason: string | null;\n",
     "  lastWatchdogTerminalReason: string | null;\n  /** The `api_error_code` a `permanent_api_error` park is about — a typed fact read from the\n   * watchdog's terminal, never prose; absent or `null` for every other park. */\n  apiErrorCode?: string | null;\n"),
    ("  return `# Campaign needs the owner: ${ctx.campaignSlug}\n\n**Park reason:** ${ctx.reason}\n",
     "  const apiErrorCode = ctx.apiErrorCode ?? null;\n  const reasonLine = apiErrorCode === null ? ctx.reason : `${ctx.reason} (${apiErrorCode})`;\n  const apiErrorLine = apiErrorCode === null ? '' : `\\nAPI error code: \\`${apiErrorCode}\\``;\n\n  return `# Campaign needs the owner: ${ctx.campaignSlug}\n\n**Park reason:** ${reasonLine}\n"),
    ("## What happened\n${sentence.what}\n",
     "## What happened\n${sentence.what}${apiErrorLine}\n"),
  ],
}
out = {}
for rel, edits in EDITS.items():
    text = (R / rel).read_text(encoding='utf-8')
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            sys.exit(f'apply-task7: {rel}: expected 1 match, found {n}: {old[:70]!r}')
        text = text.replace(old, new)
    out[rel] = text
for rel, text in out.items():
    (R / rel).write_text(text, encoding='utf-8')
print('apply-task7: 4 files changed')
PY
````

Expected: `apply-task7: 4 files changed`.

- [ ] **Step 4: Green**:

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/decide.test.ts core/supervisor/status.test.ts 2>&1 | tail -n 4
cd plugins/tribe/scripts/runner && bunx tsc --noEmit; echo "tsc=$?"
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only supervise | tail -n 5
```

Expected: ` 89 pass`, ` 0 fail`; `tsc=0`; `ok - supervise: exactly one spawn before the park`,
`ok - supervise: the park reason carries the API error code`,
`ok - supervise: NEEDS_OWNER.md names the code in its owner-facing text`, `3 passed, 0 failed`, `PAE=PASS`.

#### Verify

- Goal: G3 end to end — the campaign parks on the FIRST occurrence with `claude_code_version_too_old`
  in the park reason and the owner-facing text, and spawns nothing more (ratchet: supervise spawns
  before park 23 → 1, Task 1's evidence file).
- Red: `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only supervise` before
  Step 3 → `(got: 20, want: 1)`, `PAE=FAIL`.
- Green: `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only supervise | tail -n 5`
  → the three `ok -` lines, `3 passed, 0 failed`, `PAE=PASS` (exit 0); the rest of Step 4 prints exactly
  the lines listed under it.
- Stub check: without the G5 exemption the terminal is re-read as `session_incomplete` and the probe
  counts 20 spawns; without the row the reason is unrecognised and parks `error`, failing the reason
  check; a render that drops the code fails the `NEEDS_OWNER.md` check.

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test core/supervisor/decide.test.ts core/supervisor/status.test.ts
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only supervise
```

- [ ] **Step 5: Commit**

```bash
git add plugins/tribe/scripts/runner/core/supervisor/model.ts plugins/tribe/scripts/runner/core/supervisor/loop.ts plugins/tribe/scripts/runner/core/supervisor/decide.ts plugins/tribe/scripts/runner/core/supervisor/status.ts plugins/tribe/scripts/runner/core/supervisor/decide.test.ts plugins/tribe/scripts/runner/core/supervisor/status.test.ts
git commit -m "feat(supervisor): park permanent_api_error on the first occurrence, naming the api_error_code (G3)"
```

### Task 7: The documented recovery resumes the campaign (D4, reproduced)

**Files:** modify `runner/core/supervisor/model.ts`, `runner/core/supervisor/decide.ts`,
`runner/core/supervisor/state.ts`, `runner/core/supervisor/loop.ts`,
`runner/core/supervisor/decide.test.ts`, `runner/core/supervisor/loop.test.ts`.

D4 reproduced while planning (spec §1): after a `session_incomplete` park, `reset-card`, deleting
`NEEDS_OWNER.md` and re-running `supervise` parks again at once, 0 spawns, no `run_watchdog` —
because the supervisor re-reads the old terminal from `watchdog/status.json` and the spent retrigger
from `supervisor/state.json`. After Task 6 the same happens to a `permanent_api_error` park. The
skill documents deleting `NEEDS_OWNER.md` as the owner's "I have handled it" signal; this task reads
it as one. At start, if the previous run's park (`priorParkedTerminal`, already snapshotted) has no
`NEEDS_OWNER.md` left, it becomes `acknowledgedPark`. New row P5 (after P4): an acknowledged park
decided from the watchdog's terminal runs a fresh watchdog (`retrigger: 'owner_resume'`, under the
run cap); the loop then clears the three watchdog one-shot retrigger keys (pure `clearWatchdogRetriggers`)
and the acknowledgement. Escalation and session parks are not resumed this way (their rows re-read
the files the owner edited). A present `NEEDS_OWNER.md` is refused exactly as before.

- [ ] **Step 1: The failing tests**:

````bash
python3 - <<'PY'
# Task 8 tests: appended to the existing suites (their assertions above stay unchanged).
import pathlib
R = pathlib.Path('plugins/tribe/scripts/runner')
DECIDE = '''
describe('decide — P5: the owner acknowledged a watchdog-terminal park (card runner-model-support, G4)', () => {
  const acked = (reason: string, over: Partial<SupervisorObservation> = {}) => base({
    acknowledgedPark: { reason, atMs: 900_000 },
    lastWatchdog: terminal(reason),
    state: { ...base().state, watchdogRuns: 2, retriggers: { session_incomplete: 1 } },
    ...over,
  });
  test('the 2026-10-01 shape: a spent session_incomplete terminal runs a fresh watchdog, not a re-park', () => {
    expect(decide(acked('session_incomplete')))
      .toEqual({ kind: 'run_watchdog', cards: null, includeEscalated: false, retrigger: 'owner_resume' });
  });
  test.each(['permanent_api_error', 'quota_cap', 'overloaded', 'stalled', 'error'])('%s resumes the same way', (reason) => {
    expect(decide(acked(reason))).toMatchObject({ kind: 'run_watchdog', retrigger: 'owner_resume' });
  });
  test('an escalation park (owner_only) is NOT resumed this way — its own rows re-read the edited files', () => {
    expect(decide(acked('owner_only', { lastWatchdog: terminal('session_incomplete') })))
      .toEqual({ kind: 'park', reason: 'session_incomplete', detail: expect.any(String) });
  });
  test('the watchdog-run cap still holds', () => {
    expect(decide(acked('session_incomplete', { state: { ...base().state, watchdogRuns: 20 } })))
      .toMatchObject({ kind: 'park', reason: 'watchdog_run_cap' });
  });
  test('a live watchdog is still adopted first (P4)', () => {
    expect(decide(acked('session_incomplete', { watchdogLive: { pid: 7, alive: true } })))
      .toEqual({ kind: 'await_watchdog', pid: 7 });
  });
  test('without an acknowledgement the old terminal parks exactly as before (the reproduced defect, now scoped)', () => {
    expect(decide(acked('session_incomplete', { acknowledgedPark: null })))
      .toMatchObject({ kind: 'park', reason: 'session_incomplete' });
  });
});
'''
LOOP = '''
describe('runSupervisor — the documented recovery resumes the campaign (card runner-model-support, G4)', () => {
  // The 2026-10-01 shape after the owner's recovery: a previous run parked session_incomplete
  // (supervisor/status.json), its retrigger is spent (state.json), the watchdog's terminal still
  // says session_incomplete, and the owner has deleted NEEDS_OWNER.md.
  const parkedFiles = (needsOwner: boolean): Record<string, string> => ({
    [join(HOME, 'supervisor', 'status.json')]: JSON.stringify({
      v: 1, pid: 1, updatedAt: '2026-10-01T14:37:20.685Z',
      terminal: { status: 'needs_owner', reason: 'session_incomplete', exitCode: 20 },
    }),
    [join(HOME, 'supervisor', 'state.json')]: JSON.stringify({
      v: 1, ...zeroState(), watchdogRuns: 2, retriggers: { session_incomplete: 1 },
    }),
    [join(HOME, 'watchdog', 'status.json')]: JSON.stringify({
      pid: 777, terminal: { status: 'needs_human', reason: 'session_incomplete', exitCode: 10 },
    }),
    ...(needsOwner ? { [join(HOME, 'NEEDS_OWNER.md')]: '# parked\\n' } : {}),
  });

  test('NEEDS_OWNER.md deleted: a fresh watchdog runs, and its outcome decides', async () => {
    const seam = fakeSeam({
      initialFiles: parkedFiles(false), initialDeadPids: [777],
      watchdogRuns: [{ reason: 'stop_requested', exitCode: 0 }],
    });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(seam.spawnWatchdogCalls).toBe(1);
    expect(result).toMatchObject({ exitCode: 0, kind: 'done', reason: 'stop_requested' });
    const state = JSON.parse(seam.files.get(join(HOME, 'supervisor', 'state.json')) as string);
    expect(state.retriggers.session_incomplete).toBeUndefined();
    expect(state.watchdogRuns).toBe(3);
  });

  test('NEEDS_OWNER.md still present: still refused, nothing spawned (the latch holds)', async () => {
    const seam = fakeSeam({ initialFiles: parkedFiles(true), initialDeadPids: [777] });
    const result = await runSupervisor(baseConfig(), HOME, seam.io);
    expect(seam.spawnWatchdogCalls).toBe(0);
    expect(result).toMatchObject({ exitCode: 20, kind: 'needs_owner', reason: 'resume_blocked' });
  });
});
'''
d = (R / 'core/supervisor/decide.test.ts').read_text(encoding='utf-8') + DECIDE
l = (R / 'core/supervisor/loop.test.ts').read_text(encoding='utf-8') + LOOP
(R / 'core/supervisor/decide.test.ts').write_text(d, encoding='utf-8')
(R / 'core/supervisor/loop.test.ts').write_text(l, encoding='utf-8')
print('tests-task8: 2 suites extended')
PY
````

- [ ] **Step 2: Run them red** — `cd plugins/tribe/scripts/runner && bun test core/supervisor/decide.test.ts core/supervisor/loop.test.ts 2>&1 | tail -n 4`
  → ` 110 pass`, ` 8 fail`; `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only recovery`
  → `not ok - recovery: the re-run supervisor runs a fresh watchdog (got: no, want: yes)`,
  `not ok - recovery: the campaign reaches a launch (new executor spawns) (got: no, want: yes)`, `PAE=FAIL`.

- [ ] **Step 3: Build**:

````bash
python3 - <<'PY'
# Task 8 apply script: each replacement must match exactly once, or nothing is written.
import pathlib, sys
R = pathlib.Path('plugins/tribe/scripts/runner')
EDITS = {
  'core/supervisor/model.ts': [
    ("  parkedTerminal: { reason: string; atMs: number } | null;\n  /** The supervisor's own persisted counters. */",
     "  parkedTerminal: { reason: string; atMs: number } | null;\n"
     "  /** Card runner-model-support (G4): the park a PREVIOUS invocation recorded, when\n"
     "   * `NEEDS_OWNER.md` was already gone at THIS invocation's start — the owner deleted it, which is\n"
     "   * the documented \"I have handled it\" signal. Captured once at startup and cleared once acted on,\n"
     "   * so it is set on at most one tick. Optional so every existing fixture stays as written. */\n"
     "  acknowledgedPark?: { reason: string; atMs: number } | null;\n"
     "  /** The supervisor's own persisted counters. */"),
    ("    retrigger: 'stale_terminal' | null;\n",
     "    retrigger: 'stale_terminal' | 'owner_resume' | null;\n"),
  ],
  'core/supervisor/decide.ts': [
    ("/** §3.4 row 23: these five terminal reasons",
     "/** Card runner-model-support (G4): parks decided from the WATCHDOG's terminal alone. Once the owner\n"
     " * has deleted `NEEDS_OWNER.md` for one of these, that terminal is spent: re-reading it would park\n"
     " * again before anything ran (the 2026-10-01 incident), so the supervisor runs a fresh watchdog.\n"
     " * Escalation and session parks are absent on purpose: their rows re-read the escalation files and\n"
     " * answers.md the owner just edited, which is already the right recovery. */\n"
     "const WATCHDOG_TERMINAL_PARK_REASONS: ReadonlySet<string> = new Set([\n"
     "  'session_incomplete', 'permanent_api_error', 'quota_cap', 'overloaded', 'stalled', 'lock_conflict',\n"
     "  'error', 'unexpected_running', 'watchdog_no_terminal', 'watchdog_usage',\n"
     "]);\n\n"
     "/** §3.4 row 23: these five terminal reasons"),
    ("  if (o.watchdogLive !== null && o.watchdogLive.alive) {\n    return { kind: 'await_watchdog', pid: o.watchdogLive.pid };\n  }\n",
     "  if (o.watchdogLive !== null && o.watchdogLive.alive) {\n    return { kind: 'await_watchdog', pid: o.watchdogLive.pid };\n  }\n"
     "  // P5 (card runner-model-support, G4): the owner deleted NEEDS_OWNER.md for a park decided from\n"
     "  // the watchdog's terminal — the documented recovery. That terminal is spent, so run a fresh\n"
     "  // watchdog (still under the run cap) instead of re-deciding from it.\n"
     "  const acknowledged = o.acknowledgedPark ?? null;\n"
     "  if (acknowledged !== null && WATCHDOG_TERMINAL_PARK_REASONS.has(acknowledged.reason)) {\n"
     "    if (o.state.watchdogRuns >= o.limits.maxWatchdogRuns) {\n"
     "      return park('watchdog_run_cap', `the watchdog was re-triggered its maximum ${o.limits.maxWatchdogRuns} times`);\n"
     "    }\n"
     "    return { kind: 'run_watchdog', cards: null, includeEscalated: false, retrigger: 'owner_resume' };\n"
     "  }\n"),
  ],
  'core/supervisor/state.ts': [
    ("export type ParseStateResult =",
     "/** The one-shot retrigger budgets that belong to a watchdog terminal (decide.ts rows 16, 24 and the\n"
     " * G2 stale-terminal row). The owner acknowledging a park starts a new episode, so these budgets\n"
     " * start over (card runner-model-support, G4); every other counter — spawns, ruling rounds, the\n"
     " * repeat-escalation breaker, a session's own retry key — is kept. */\n"
     "export const WATCHDOG_RETRIGGER_KEYS = ['session_incomplete', 'watchdog_no_terminal', 'stale_terminal'] as const;\n\n"
     "export function clearWatchdogRetriggers(state: SupervisorState): SupervisorState {\n"
     "  const retriggers = { ...state.retriggers };\n"
     "  for (const key of WATCHDOG_RETRIGGER_KEYS) delete retriggers[key];\n"
     "  return { ...state, retriggers };\n"
     "}\n\n"
     "export type ParseStateResult ="),
  ],
  'core/supervisor/loop.ts': [
    ("  applyRulingOutcome, parseState as parseSupervisorState, serializeState, zeroState,\n",
     "  applyRulingOutcome, clearWatchdogRetriggers, parseState as parseSupervisorState, serializeState, zeroState,\n"),
    ("  priorParkedTerminal: { reason: string; atMs: number } | null;\n}\n",
     "  priorParkedTerminal: { reason: string; atMs: number } | null;\n"
     "  /** Card runner-model-support (G4): `priorParkedTerminal`, when `NEEDS_OWNER.md` was already gone\n"
     "   * at startup — the owner's acknowledgement. Cleared the moment the `owner_resume` watchdog run\n"
     "   * it causes is performed, so it decides at most one tick. Optional (absent = none) so a test that\n"
     "   * builds a LoopState by hand stays as written. */\n"
     "  acknowledgedPark?: { reason: string; atMs: number } | null;\n}\n"),
    ("    parkedTerminal,\n    state: supState,",
     "    parkedTerminal,\n    acknowledgedPark: loopState.acknowledgedPark ?? null,\n    state: supState,"),
    ("    priorParkedTerminal: readParkedTerminal(io, paths.status),\n  };\n",
     "    priorParkedTerminal: readParkedTerminal(io, paths.status),\n    acknowledgedPark: null,\n  };\n"
     "  // Both read before the first publish, like `priorParkedTerminal` itself: a park recorded by a\n"
     "  // previous run whose NEEDS_OWNER.md is already gone is one the owner has acknowledged.\n"
     "  if (!entryExists(io, homeDir, 'NEEDS_OWNER.md')) loopState.acknowledgedPark = loopState.priorParkedTerminal;\n"),
    ("        if (observation.lastWatchdog !== null) {\n          const priorReason = observation.lastWatchdog.terminal?.reason ?? null;",
     "        if (action.retrigger === 'owner_resume') {\n"
     "          // G4: a new episode — the old terminal's one-shot budgets start over, and the\n"
     "          // acknowledgement is spent so it can never fire twice.\n"
     "          supState = clearWatchdogRetriggers(supState);\n"
     "          loopState.acknowledgedPark = null;\n"
     "        } else if (observation.lastWatchdog !== null) {\n"
     "          const priorReason = observation.lastWatchdog.terminal?.reason ?? null;"),
  ],
}
out = {}
for rel, edits in EDITS.items():
    text = (R / rel).read_text(encoding='utf-8')
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            sys.exit(f'apply-task8: {rel}: expected 1 match, found {n}: {old[:70]!r}')
        text = text.replace(old, new)
    out[rel] = text
for rel, text in out.items():
    (R / rel).write_text(text, encoding='utf-8')
print('apply-task8: 4 files changed')
PY
````

Expected: `apply-task8: 4 files changed`.

- [ ] **Step 4: Green** — the supervisor's whole suite, the type check, and every probe of the
  end-to-end tool:

```bash
cd plugins/tribe/scripts/runner && bun test core/supervisor/ 2>&1 | tail -n 4
cd plugins/tribe/scripts/runner && bunx tsc --noEmit; echo "tsc=$?"
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh | tail -n 3
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --measure
```

Expected: ` 403 pass`, ` 0 fail`; `tsc=0`; `9 passed, 0 failed`, `PAE=PASS`; and the measured
after-numbers

```text
runner_serial_spawns=1
runner_pool_spawns=2
watchdog_spawns=1 watchdog_terminal=permanent_api_error claude_code_version_too_old
supervise_spawns_before_park=1 park_reason=permanent_api_error (claude_code_version_too_old)
```

followed by one `recovery_new_spawns=N recovery_run_watchdog=M recovery_park_reason=spawn_cap` line
with N ≥ 1 and M ≥ 1 (the fixed double then reports a task the Done commands reject, so the card
escalates and `--max-spawns 0` parks before any ruling session — no real model is ever called).

#### Verify

- Goal: G4 — after the owner fixes the cause, `reset-card`, deleting `NEEDS_OWNER.md` and re-running
  `supervise` reaches a launch (ruling D4: reproduced, so fixed here); ratchet recovery spawns 0 → ≥ 1.
- Red: `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --only recovery` before
  Step 3 → both recovery checks `(got: no, want: yes)`, `PAE=FAIL`.
- Green: `bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh | tail -n 3` →
  `9 passed, 0 failed`, `PAE=PASS` (exit 0); the rest of Step 4 prints the lines listed under it.
- Stub check: without P5 the supervisor re-parks from the old terminal (the reproduced defect): the
  recovery probe and 8 unit tests fail; a P5 that keeps the spent retrigger fails the loop test's
  `retriggers.session_incomplete` check; a P5 that ignores the latch fails "NEEDS_OWNER.md still
  present: still refused".

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
cd plugins/tribe/scripts/runner && bun test core/supervisor/
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh
```

- [ ] **Step 5: Commit**

```bash
git add plugins/tribe/scripts/runner/core/supervisor/model.ts plugins/tribe/scripts/runner/core/supervisor/decide.ts plugins/tribe/scripts/runner/core/supervisor/state.ts plugins/tribe/scripts/runner/core/supervisor/loop.ts plugins/tribe/scripts/runner/core/supervisor/decide.test.ts plugins/tribe/scripts/runner/core/supervisor/loop.test.ts
git commit -m "fix(supervisor): a park the owner acknowledged resumes with a fresh watchdog instead of re-parking (G4, D4)"
```

### Task 8: The preflight probes every campaign model (G5), and the README says what the runner now does

**Files:** modify `skills/orchestrate-campaign/SKILL.md`, `runner/README.md`.

Ruling D2: orchestrate-campaign's preflight calls `doctor.sh --model` with the campaign's executor and
watchdog models. The runner README gains one section (the probe, the allowlist, the three-layer stop,
the recovery) and the rows its watchdog and supervisor tables lack. No restated ways-of-work rule
(the drift counter stays at 2).

- [ ] **Step 1: Red** — the texts do not exist yet:

```bash
python3 -c "import sys; s=open('plugins/tribe/skills/orchestrate-campaign/SKILL.md').read(); r=open('plugins/tribe/scripts/runner/README.md').read(); print('--model <the campaign' in s, 'permanent_api_error' in s, '## Permanent API errors and the model probe' in r, '(P5)' in r)"
```

Expected: `False False False False`.

- [ ] **Step 2: Write the docs**:

````bash
python3 - <<'PY'
# Task 9 apply script (docs): each replacement must match exactly once, or nothing is written.
import pathlib, sys
P = pathlib.Path('plugins/tribe')
README = 'scripts/runner/README.md'
SKILL = 'skills/orchestrate-campaign/SKILL.md'
SECTION = '''## Permanent API errors and the model probe (card runner-model-support)

**A model the runner's SDK cannot run is refused before launch.** The runner drives its executor
sessions through the Claude Code binary bundled with `@anthropic-ai/claude-agent-sdk` (pinned in
`package.json`, frozen in `bun.lock`) — never the machine's own `claude`. A model newer than that
bundled Claude Code is refused by the API (`claude_code_version_too_old`). The `probe-model`
subcommand asks the runner's own SDK whether it can run one model — one tiny real session (one
turn, no tools, no settings; about a cent and a few seconds), bounded, never via
`ANTHROPIC_API_KEY`:

```sh
bun plugins/tribe/scripts/runner/run.ts probe-model --model <id> [--timeout-seconds 10..600]
```

It prints `ok: model <id> runs on the runner's SDK (Claude Code <version>)` and exits `0`, or
prints `refused: model <id> … — <the API's own reason> [HTTP <status>, api_error_code <code>]` and
`fix: <what to do>` and exits `1`; a usage error exits `2`. `doctor.sh --model <id>` (repeatable)
runs it for each model and relays those lines, so the campaign preflight names the model, the
reason and the fix. `--dry-run` never calls a model; it stays the runner's zero-LLM check.

**A permanent API error stops the campaign on its first occurrence.** `core/api-error.ts` holds the
allowlist of `api_error_code` values that no retry can fix — today only
`claude_code_version_too_old`, the one code a real session has been seen returning. An unknown
model id carries no code at all (HTTP 404 only), so it stays on the ordinary path and is refused
by `doctor.sh --model` instead. A code earns a place on the list only from a real run: treating a
transient error as permanent would park a healthy campaign. When a session's `result` carries a
listed code:

- the runner stops that card without a retry or a fresh fallback session, and starts no further
  card in this pass (`--max-concurrent` lets the cards already in flight finish); it exits `3`;
- the watchdog exits `needs_human:permanent_api_error`, its `status.json` terminal carrying
  `apiErrorCode` — only for a run this invocation tracked;
- the supervisor parks `permanent_api_error` at once, with no retrigger; `NEEDS_OWNER.md` reads
  `**Park reason:** permanent_api_error (<code>)` and names the code under "What happened".

**The recovery resumes the campaign.** Fix the cause (for `claude_code_version_too_old`: bump the
SDK and `bun install` here), confirm it with `doctor.sh --model <id>`, run `reset-card` for each
stopped card, delete `NEEDS_OWNER.md`, and re-run `supervise`. A park decided from the watchdog's
terminal (`session_incomplete`, `permanent_api_error`, `quota_cap`, `overloaded`, `stalled`,
`lock_conflict`, `error`, `unexpected_running`, `watchdog_no_terminal`, `watchdog_usage`) whose
`NEEDS_OWNER.md` the owner deleted is acknowledged: the supervisor runs a fresh watchdog instead
of re-deciding from the old terminal, and that terminal's one-shot retrigger budgets start over.

'''
EDITS = {
  README: [
    ("## How this is normally triggered\n", SECTION + "## How this is normally triggered\n"),
    ("| Runner exited `3` or an unrecognized code (or crashed with no exit code to read), no quota or overload signal | `relaunch` once;",
     "| Runner exited `3` or an unrecognized code (or crashed with no exit code to read), newest log's **last** `result` line carries an allowlisted permanent `api_error_code` (`core/api-error.ts`), and this invocation tracked that run | `exit(needs_human:permanent_api_error)` at once, `status.json`'s terminal carrying `apiErrorCode`; it outranks quota, overload, the crash budget and `STOP`. An older run's log read again by a fresh watchdog launches a runner instead. |\n"
     "| Runner exited `3` or an unrecognized code (or crashed with no exit code to read), no quota or overload signal | `relaunch` once;"),
    ("(`escalations_pending`, `error`, `quota_cap`, `overloaded`, `session_incomplete`, `lock_conflict`, `stalled`)",
     "(`escalations_pending`, `error`, `quota_cap`, `overloaded`, `session_incomplete`, `lock_conflict`, `stalled`, `permanent_api_error`)"),
    ("| A watchdog is already live (P4) | `await_watchdog` — adopted, never relaunched. |\n",
     "| A watchdog is already live (P4) | `await_watchdog` — adopted, never relaunched. |\n"
     "| The previous run parked on a watchdog terminal and the owner has deleted `NEEDS_OWNER.md` (P5) | `run_watchdog` with retrigger `owner_resume` (under the run cap): the old terminal is spent, never re-decided; its one-shot retrigger budgets start over. |\n"),
    ("| Watchdog terminal `quota_cap` / `overloaded` / `stalled` / `lock_conflict` / `error` (rows 18-22) | `park` with the matching reason — never retried automatically. |\n",
     "| Watchdog terminal `quota_cap` / `overloaded` / `stalled` / `lock_conflict` / `error` (rows 18-22) | `park` with the matching reason — never retried automatically. |\n"
     "| Watchdog terminal `permanent_api_error` | `park(permanent_api_error)` on the first occurrence, naming the `apiErrorCode` — never retried. Run.json's own `session_incomplete` for that same run never replaces it. |\n"),
  ],
  SKILL: [
    ("```sh\nbash \"$(dirname \"$(dirname \"$runner_dir\")\")/scripts/doctor.sh\"\n```\n\nIt exits 0 when every prerequisite is present, or exits 1 naming each gap and its remedy.",
     "```sh\nbash \"$(dirname \"$(dirname \"$runner_dir\")\")/scripts/doctor.sh\" \\\n  --model <the campaign's executor model> --model <its watchdog model>\n```\n\n"
     "Pass `--model` once for every model the campaign will use — the `--model` and `--watchdog-model`\n"
     "you will give `supervise` (the same id twice is fine). For each, doctor runs one tiny real\n"
     "session through the runner's own SDK and reports `ok`, or `MISSING` with the model, the API's\n"
     "own reason and the fix — a model newer than the runner's bundled Claude Code is refused here,\n"
     "before launch, instead of failing every session of the campaign.\n\n"
     "It exits 0 when every prerequisite is present, or exits 1 naming each gap and its remedy."),
    ("   (`runner_done` · `escalations_pending` · `session_incomplete` ·\n   `quota_cap` · `overloaded` · `stalled` · `lock_conflict` · `error` · `stop_requested`)",
     "   (`runner_done` · `escalations_pending` · `session_incomplete` ·\n   `quota_cap` · `overloaded` · `stalled` · `lock_conflict` · `error` · `stop_requested` ·\n   `permanent_api_error` — the session's model call failed in a way no retry fixes; its `apiErrorCode` names why)"),
    ("6. **Restart the supervisor**, detached, with the exact command `NEEDS_OWNER.md` printed.\n",
     "6. **Restart the supervisor**, detached, with the exact command `NEEDS_OWNER.md` printed. For a\n"
     "   park the watchdog's terminal decided (`session_incomplete`, `permanent_api_error`, `quota_cap`,\n"
     "   `overloaded`, `stalled`, and the like), deleting the file is what lets it resume: the restarted\n"
     "   supervisor runs a fresh watchdog instead of parking again on the old terminal. Fix the cause\n"
     "   first, and `reset-card` each stopped card (runner README, \"Permanent API errors and the model\n"
     "   probe\").\n"),
  ],
}
out = {}
for rel, edits in EDITS.items():
    text = (P / rel).read_text(encoding='utf-8')
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            sys.exit(f'apply-task9: {rel}: expected 1 match, found {n}: {old[:70]!r}')
        text = text.replace(old, new)
    out[rel] = text
for rel, text in out.items():
    (P / rel).write_text(text, encoding='utf-8')
print('apply-task9: 2 files changed')
PY
````

Expected: `apply-task9: 2 files changed`.

- [ ] **Step 3: Green**:

```bash
python3 -c "import sys; s=open('plugins/tribe/skills/orchestrate-campaign/SKILL.md').read(); r=open('plugins/tribe/scripts/runner/README.md').read(); print('--model <the campaign' in s, 'permanent_api_error' in s, '## Permanent API errors and the model probe' in r, '(P5)' in r)"
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh | tail -n 1
bash plugins/tribe/scripts/tests/test-watchdog-detached.sh | tail -n 1
cd plugins/tribe/scripts/runner && bun test core/supervisor/brief.test.ts 2>&1 | tail -n 4
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . | tail -n 1
```

Expected: `True True True True`; `41 passed, 0 failed`; `9 passed, 0 failed`; ` 0 fail`;
`ways-of-work definitions: 2`.

#### Verify

- Goal: G5 — the orchestrate-campaign preflight runs `doctor.sh --model` for every model the campaign
  will use, before launch; the runner README documents the probe, the allowlist, the stop and the
  recovery as the code now does them.
- Red: Step 1's command → `False False False False`.
- Green: `bash plugins/tribe/scripts/tests/test-supervisor-docs.sh | tail -n 1` → `41 passed, 0 failed`
  (exit 0), and Step 3's other commands print exactly the lines listed under it (`True True True True`
  first).
- Stub check: an empty edit leaves Step 1's four facts `False`; a preflight line without `--model`
  leaves the first `False`.

#### Done

```bash
python3 -c "import sys; s=open('plugins/tribe/skills/orchestrate-campaign/SKILL.md').read(); r=open('plugins/tribe/scripts/runner/README.md').read(); sys.exit(0 if '--model <the campaign' in s and 'permanent_api_error' in s and '## Permanent API errors and the model probe' in r and '(P5)' in r else 1)"
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
bash plugins/tribe/scripts/tests/test-watchdog-detached.sh
bun plugins/tribe/scripts/ways-of-work/drift.ts --repo . --json | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin)['count'] == 2 else 1)"
```

- [ ] **Step 4: Commit**

```bash
git add plugins/tribe/skills/orchestrate-campaign/SKILL.md plugins/tribe/scripts/runner/README.md
git commit -m "docs(tribe): the preflight probes every campaign model; the runner README documents permanent API errors (G5)"
```

### Task 9: Governance — the C3 reconciliation is deferred to #211 (ruling R4)

**Amended 2026-10-02 by the Shaman (campaign ruling R4).** The original Task 9 — a change-unit
updating `c3-215` — cannot land with the installed c3x 11.0.0: its canvas gate checks each `scope: block`
patch against the original entity plus that one patch, so `c3-215`'s five inherited rows that trip the
placeholder regex can never be fixed one at a time, and even a byte-identical no-op block patch is
rejected with `invalid required table`. `scope: whole` with a base is forbidden by `change.md`. The
reconciliation, with the executor's ready ADR and nine patches, moves to hieplam/tribe#211. This task
proves only that the card leaves the C3 model no worse: no new broken seal, and `.c3/**` untouched.

**Files:** none.

- [ ] **Step 1: Red** — not applicable: this task builds nothing; it records the deferral.

- [ ] **Step 2: Green** — `.c3/**` is unchanged on the card branch and no seal broke:

```bash
git diff --quiet origin/master...HEAD -- .c3 && echo "c3 unchanged"
```

Expected: `c3 unchanged`, and the Done command below exits 0.

Stub check: an implementation that edited `.c3/**` by hand (breaking a seal) fails both commands.

#### Verify

- Goal: governance — the card leaves the C3 model no worse (the `c3-215` update itself is deferred to #211 by R4).
- Red: not applicable — the task builds nothing; it records a deferral.
- Green: `git diff --quiet origin/master...HEAD -- .c3 && echo "c3 unchanged"` → `c3 unchanged`, and the
  c3x seal check below exits 0.
- Stub check: a hand edit under `.c3/**` (which breaks a seal) fails both commands.

#### Done

```bash
git diff --quiet origin/master...HEAD -- .c3
C3=$(ls -d ~/.claude/plugins/cache/c3-skill-marketplace/c3-skill/*/skills/c3 | tail -1) && C3X_MODE=agent bash "$C3/bin/c3x.sh" check 2>&1 | python3 -c "import sys; l=sys.stdin.read().splitlines(); sys.exit(0 if not any(x.startswith('BROKEN_SEAL') and 'runner-model-support' in x for x in l) and sum(x.startswith('BROKEN_SEAL') for x in l) <= 157 else 1)"
```

- [ ] **Step 3: Commit** — `git commit --allow-empty -m "chore(c3): defer the c3-215 reconciliation to #211 (ruling R4)"`. The final
review treats the missing `c3-215` update as deferred by R4, not as a finding.

### Task 10: Final review

**Files:** none in the repo — fixes, if any, land in the files they touch; with no fix, an empty
commit records the verdict. Outside the repo, under `$REPORTS/`: each round's review report, the
whole-suite results, and the PR body's `## Final review` section.

The block's final review: a fresh `general-purpose` reviewer that built none of this card gets the
card (`~/.tribe/-Users-home-repos-tribe/cards/runner-model-support.md`: goal rows G1–G5, rulings
D1–D4, the scope fence), the spec, this plan (its Global Constraints' oracles and the Adjudication
section, verbatim), the branch diff (`git diff origin/master...HEAD`), and its report path:
`$REPORTS/runner-model-support-review-1.md` (`-review-2.md`, `-review-3.md` for re-reviews). It judges
the diff against every goal row and the scope fence, runs Steps 1 and 2, rates each finding Blocker,
Should-fix or Optional, and ends its report with `REVIEW: FAIL` when any finding is Should-fix or
worse, else `REVIEW: PASS`, followed by its findings with their ratings and evidence. A
`REVIEW: PASS` that lists a Should-fix or Blocker finding counts as `REVIEW: FAIL`. On
`REVIEW: FAIL`: one fresh fix subagent per round with the findings, the Verify of every task a fix
touches re-run, a fresh reviewer — at most 2 fix rounds, all inside this task's turn; still failing,
end the turn with `NEEDS_DIRECTION:` and the findings.

- [ ] **Step 1: Every task's Green and the end-to-end checks** — the reviewer runs (the three
  `env -u ANTHROPIC_API_KEY` lines are real model calls, about $0.17 together):

```bash
(cd plugins/tribe/scripts/runner && bun install --frozen-lockfile)
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh | tail -n 2
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh --measure
cat docs/superpowers/evidence/2026-10-01-runner-model-support-g3-baseline.txt
bash plugins/tribe/scripts/tests/test-doctor-model.sh | tail -n 2
(cd plugins/tribe/scripts/runner && bunx tsc --noEmit; echo "tsc=$?")
(cd plugins/tribe/scripts/runner && RUN_SESSION_E2E=1 env -u ANTHROPIC_API_KEY bun test core/model-support.e2e.test.ts 2>&1 | tail -n 3)
(cd plugins/tribe/scripts/runner && env -u ANTHROPIC_API_KEY bun run.ts probe-model --model claude-opus-5-5; echo "exit=$?")
(cd plugins/tribe/scripts/runner && env -u ANTHROPIC_API_KEY bun run.ts probe-model --model claude-nonexistent-9; echo "exit=$?")
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh | tail -n 1
bash plugins/tribe/scripts/validate-plan.sh docs/superpowers/plans/2026-10-01-runner-model-support.md | python3 -c "import json,sys; print(json.load(sys.stdin)['verdict'])"
home="$(mktemp -d)"; : > "$home/answers.md"; python3 -c "import json,re,sys; plan='docs/superpowers/plans/2026-10-01-runner-model-support.md'; heads=re.findall(r'^### (Task \d+: .*)$', open(plan, encoding='utf-8').read(), re.M); card={'status':'staged','spec':'docs/superpowers/specs/2026-10-01-runner-model-support-design.md','plan':plan,'branch':None,'baseSha':None,'pr':None,'mergeSha':None,'sessionId':None,'updatedAt':None,'tasks':[{'id':f'T{i+1}','heading':h} for i,h in enumerate(heads)]}; json.dump({'v':2,'campaign':'rms','planning':{'mode':'self'},'mergePolicy':'regular','sequence':['rms'],'schemaLockPaths':[],'docsOnlyPaths':[],'ownerOnlyEscalations':[],'cards':{'rms':card}}, open(sys.argv[1]+'/campaign-state.json','w'))" "$home"
bun plugins/tribe/scripts/runner/run.ts --repo "$PWD" --model fixture --home "$home" --no-viewer --dry-run < /dev/null > "$home/dry-run.json"; echo "exit=$?"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['cardId'], d['phase']['kind'])" "$home/dry-run.json"
```

Expected, in order: `9 passed, 0 failed` and `PAE=PASS`; the four after-lines of Task 7 Step 4 and a
`recovery_new_spawns=` line with both numbers ≥ 1; the baseline file's five lines (23 → 1 is the G3
ratchet); `19 passed, 0 failed` and `DOCTOR-MODEL=PASS`; `tsc=0`; ` 1 pass`; the `ok: model claude-opus-5-5 …
(Claude Code 2.1.286)` line and `exit=0`; a `refused: model claude-nonexistent-9 …` line naming
`[HTTP 404]`, a `fix: check the model id …` line and `exit=1`; `41 passed, 0 failed`; `pass`; `exit=0`
and `rms fresh`.

- [ ] **Step 2: The whole suite (the final review's whole-suite run)** — save the script, then run it
  once per suite, one Bash call each (every call stays under the harness's 10-minute limit):

```bash
cat > "$REPORTS/rms-suite.sh" <<'SH'
#!/usr/bin/env bash
# rms-suite.sh — this repo's whole test suite, one suite per call (card runner-model-support).
#   rms-suite.sh list          print every suite's name, one per line
#   rms-suite.sh run NAME      run that one suite from ROOT (default: the current directory),
#                              bounded by 540 s (KILL 10 s later); print "NAME rc=N" (124/137 =
#                              the bound was hit). Its output goes to $LOGS/NAME.log.
# Excluded: scripts/evals/ and plugins/tribe/evals/ (billed); the opt-in real-model tests skip
# themselves unless RUN_SESSION_E2E=1 or TRIBE_REAL_E2E=1, which this script never sets.
set -uo pipefail
ROOT="${ROOT:-.}"
cd "$ROOT" || exit 2
suites() {
  printf '%s\n' runner-bun viewer-bun gaps-bun cli-bun misc-bun
  for t in plugins/*/scripts/tests/test-*.sh; do printf '%s\n' "$t"; done
}
case "${1:-}" in
  list) suites ;;
  run)
    name="${2:?usage: rms-suite.sh run NAME}"
    : "${LOGS:?set LOGS to a log directory}"
    mkdir -p "$LOGS"
    log="$LOGS/$(basename "$name").log"
    case "$name" in
      runner-bun) cmd=(bash -c 'cd plugins/tribe/scripts/runner && bun install --frozen-lockfile && bun test') ;;
      viewer-bun) cmd=(bash -c 'cd plugins/tribe/scripts/viewer && bun install --frozen-lockfile && bun test') ;;
      gaps-bun)   cmd=(bash -c 'cd plugins/tribe/scripts/gaps && bun install --frozen-lockfile && bun test') ;;
      cli-bun)    cmd=(bash -c 'cd plugins/tribe/scripts/viewer && bun install --frozen-lockfile && bun run build && cd ../cli && bun install --frozen-lockfile && bun test') ;;
      misc-bun)   cmd=(bun test plugins/tribe/scripts/ways-of-work/ plugins/tribe/scripts/tests/ plugins/tribe/scripts/session-hygiene.test.ts) ;;
      plugins/*/scripts/tests/test-*.sh) cmd=(bash "$name") ;;
      *) echo "rms-suite: unknown suite: $name" >&2; exit 2 ;;
    esac
    perl -e 'alarm shift; exec @ARGV or die "exec: $!"' 540 "${cmd[@]}" > "$log" 2>&1
    echo "$name rc=$?" ;;
  *) echo "usage: rms-suite.sh list | run NAME" >&2; exit 2 ;;
esac
SH
export LOGS="$REPORTS/rms-suite-logs"
bash "$REPORTS/rms-suite.sh" list
```

For each name `list` prints, run `bash "$REPORTS/rms-suite.sh" run NAME` and append its line to
`$REPORTS/runner-model-support-suite.txt` (`rc=142` means the 540 s alarm fired: record the suite as
not finished). For every line whose `rc` is not 0, run the same suite on the base branch —
`git worktree add "$REPORTS/rms-base" origin/master` once, then
`ROOT="$REPORTS/rms-base" LOGS="$REPORTS/rms-base-logs" bash "$REPORTS/rms-suite.sh" run NAME` —
and append its line with the prefix `base: `. A suite that is non-zero on the branch and 0 on the base
is a new failure: at least Should-fix. The same non-zero on both is inherited (Adjudication item 1):
list it, rated Optional. Remove the base worktree afterwards
(`git worktree remove --force "$REPORTS/rms-base"`).

- [ ] **Step 3: Assemble the PR body's `## Final review` section** from every round's report, in
  order — each round's `REVIEW:` line and its findings — and check it:

```bash
python3 - "$REPORTS" <<'PY'
import glob, re, sys
rounds = sorted(glob.glob(sys.argv[1] + "/runner-model-support-review-*.md"), key=lambda p: int(re.search(r"-review-(\d+)[.]md$", p).group(1)))
out = ["## Final review", ""]
for n, path in enumerate(rounds, 1):
    text = open(path, encoding="utf-8").read().rstrip()
    verdict = [l for l in text.splitlines() if l.startswith("REVIEW: ")]
    out += [f"### Round {n} — {verdict[0] if verdict else 'REVIEW: (missing)'}", "", text[text.index(verdict[0]):] if verdict else text, ""]
open(sys.argv[1] + "/runner-model-support-final-review.md", "w", encoding="utf-8").write("\n".join(out).rstrip() + "\n")
last = [l for l in "\n".join(out).splitlines() if l.startswith("REVIEW: ")][-1]
print(len(rounds), "round(s); last:", last)
PY
```

#### Verify

- Goal: the final review over every goal row — G1 (the e2e test and the real probe), G2 (the doctor
  suite and the real refusal of an unknown model), G3 (the end-to-end tool against the committed
  baseline: 23 → 1), G4 (the recovery probe), G5 (the docs suite) — plus this plan's own validator
  verdict and dry run, and the whole suite against the base branch.
- Red: not applicable, the review writes no code of its own; each goal's Red was shown by its task
  (Tasks 1–9), and the G3 baseline is Task 1's evidence file.
- Green: Step 1 prints the lines listed under it; Step 2 leaves no suite that is non-zero on the
  branch and 0 on the base (`$REPORTS/runner-model-support-suite.txt`); Step 3 prints
  `N round(s); last: REVIEW: PASS` with N from 1 to 3.
- Stub check: on an empty implementation (the branch at `d3edaf0` plus this plan) the end-to-end
  tool prints `PAE=FAIL` with 23 spawns before park, the doctor suite prints `DOCTOR-MODEL=FAIL`, and
  the real probe of `claude-opus-5-5` exits 1; with no reviewer report, Step 3 exits 1 with a Python
  error instead of printing a `REVIEW: PASS` line.

#### Done

```bash
cd plugins/tribe/scripts/runner && bun install --frozen-lockfile
bash plugins/tribe/scripts/tests/test-runner-permanent-api-error.sh
bash plugins/tribe/scripts/tests/test-doctor-model.sh
cd plugins/tribe/scripts/runner && bunx tsc --noEmit
cd plugins/tribe/scripts/runner && bun test core/api-error.test.ts core/model-probe.test.ts core/session.test.ts core/loop/turns.test.ts core/watchdog/ core/supervisor/ structure.test.ts
bash plugins/tribe/scripts/tests/test-supervisor-docs.sh
bash plugins/tribe/scripts/validate-plan.sh docs/superpowers/plans/2026-10-01-runner-model-support.md | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin)['verdict'] == 'pass' else 1)"
```

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "review: final review — REVIEW: PASS (the PR body's ## Final review carries every round)"
```

## Goal → task → Verify

| Card row | Task(s) | Verify (oracle) | Before → after (tool) |
| --- | --- | --- | --- |
| G1 — a campaign on `claude-opus-5-5` runs its executor session | 3; 10 re-runs | END-TO-END: `RUN_SESSION_E2E=1 bun test core/model-support.e2e.test.ts` (the runner's own `runSession` + real SDK); the real `run.ts probe-model` | probe on `claude-opus-5-5` · refused (`claude_code_version_too_old`) → `ok` |
| G2 — `doctor.sh --model` refuses an unsupported model with the model, the API's reason and the fix; ok for a supported one | 2 (3 turns the real refusal into ok); 10 re-runs | `test-doctor-model.sh` (real captured lines, exit codes 0/1/2); the real probe refusing on 0.3.278 and on an unknown model | doctor suite · 3/19 → 19/19 |
| G3 — first occurrence parks with the exact `api_error_code` in reason and owner text; nothing more spawns | 1 (ratchet), 4, 5, 6; 10 re-runs | `test-runner-permanent-api-error.sh` (real runner, watchdog, supervise; the real Cabal line) + the pure decide tables | supervise spawns before park · 23 → 1 (runner 15 → 1, pool 15 → 2, watchdog 11 → 1) |
| G4 — the documented recovery resumes the campaign (D4 reproduced) | 7; 10 re-runs | the tool's `recovery` probe + `loop.test.ts`'s recovery scenario | recovery spawns · 0 → ≥ 1 |
| G5 — the preflight runs `doctor.sh --model` for every campaign model | 8 | the skill text check, `test-supervisor-docs.sh`, the drift counter | — |
| D1 bump, not the local CLI · D2 probe in doctor, not dry-run · D3 allowlist from real runs · D4 fix only if reproduced | 3 · 2 · 4 · 7 | as G1 · G2 · G3 · G4 | — |
| Governance | 9 | `c3-215` facts + `c3x check` (no seal broken by this unit) | — |
