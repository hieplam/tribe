/**
 * The watchdog's supervision loop: observe -> decide -> perform, until the pure core returns
 * an `exit` action. Impure BY INJECTION only (pure-core.md): every world effect arrives on
 * `io`, and every DECISION belongs to `decide()` — this file only carries them out.
 *
 * D74-2: the loop exits ONLY on done/needs_human/running, because the lead session's
 * notification IS this process's exit.
 */
import { dirname, join } from 'node:path';
import type { WatchdogAction, WatchdogConfig, WatchdogCounters, WatchdogObservation } from './model.ts';
import type { RunnerHandle, WatchdogIO } from '../../ports/ports.ts';
import { decide } from './decide.ts';
import { parseSessionSignals } from './signals.ts';
import { isStale, newestLog, newestRunId, newestRunIdExcluding, watchdogPathsOf } from './select.ts';
import { actionLine, buildStatus, exitCodeOf, serializeEvent, serializeStatus } from './status.ts';

/** Carried-forward audit requirement 2 (Task 8 dispatch): `readTail` returns `''` when the
 * window is smaller than a single log line, which makes "no signal" and "window too small"
 * look identical — `finalLineUnparseable` would never fire either. Real session-log lines run
 * to several KB (the killed-log fixture's own lines are multi-KB JSON). 64 KiB is floored here
 * and never let smaller, so an undersized window cannot silently manufacture a no-signal
 * reading. */
const LOG_TAIL_BYTES = 64 * 1024;

export interface WatchdogTerminal {
  exitCode: number;
  status: string;
  reason: string;
  statusPath: string;
}

interface LoopState {
  child: RunnerHandle | null;
  ownedExitCode: number | null;
  attempt: number;
  model: string;
  runId: string | null;
  nextWakeAtMs: number | null;
  stall: { logPath: string; lastMtimeMs: number } | null;
  runnerCommand: string[] | null;
  counters: WatchdogCounters;
  /** FIX S1: the runId THIS invocation has actually observed running (owned or adopted while
   * alive) — see `observe()`'s comment. */
  trackedRunId: string | null;
  /** D2, FIX F1 (fix round 1): the SET of run ids present on disk immediately BEFORE the most
   * recent spawn. Every one of them predates this invocation's current child and can therefore
   * never be that child's run — see `select.ts`'s `newestRunIdExcluding`. Empty until this
   * invocation has spawned anything (and empty is also the honest answer for an adopted run we
   * never spawned: the exclusion only ever applies while we own a live child). Was a single
   * `priorNewestRunId: string | null` compared by ORDERING — replaced because an unrelated
   * directory already on disk that sorts lexicographically ABOVE the new child's own id pinned
   * that ordering comparison false FOREVER (finding F1); a SET, checked by membership, is
   * immune to how any id happens to sort. */
  priorRunIds: ReadonlySet<string>;
  /** FIX F-C1/F-C2: the deadline of the most recently ORDERED `wait_until`, cleared the moment
   * any new attempt is spawned — see `model.ts`'s `WatchdogObservation.pendingWait`. */
  pendingWait: { cause: 'quota' | 'overload'; untilMs: number } | null;
  /** FIX F-C5, re-keyed for D2: THIS invocation's own clock for "how long has the currently-alive
   * run gone with no log line at all". The key is the SUPERVISION identity, not the run id:
   * while we own a live child that identity is its attempt, because the child's run id is
   * legitimately unknown for the first tick or two and then becomes known — and re-keying on
   * that transition would RESTART the silence clock, pushing a genuine stall a whole poll
   * interval past the bound the card allows ("--stall-minutes + one poll interval"). With no
   * owned child (an adopted run) the run id is the identity, exactly as before. Deliberately
   * never the record's own `startedAt`: that value is untrusted external content the runner
   * wrote (mirroring FIX S3's `MAX_QUOTA_WAIT_MS` clamp on `resetsAtEpochS` for the same
   * reason), and several pre-existing fixtures set it to an unrealistic placeholder that was
   * never meant to be read as a real elapsed-time signal — reading it here would misreport
   * those otherwise-legitimate scenarios as instantly stale. Reset to `null` the moment the run
   * stops being "alive with no log" (a log appears, the run ends, or the identity changes).
   *
   * GX1 (fix round 3, corrects a false claim M1 (fix round 1) made here): `ownsLiveChild`
   * flipping from `true` to `false` on a tick where the on-disk record is still unfinalized and
   * its pid still reads alive (our own child hard-crashing without ever writing `endedAt`, then
   * being re-observed as "adopted" because `io.isProcessAlive` still reports the pid alive — pid
   * reuse, or a lingering zombie) is the SAME run this invocation spawned, not a different one,
   * and must NOT flip `silenceKey` either — see `observe()`'s `ourOwnRun` for why. M1 claimed
   * this transition was "bounded to one poll interval late"; it is not: a crash at 25.5 minutes
   * of already-accumulated silence pushed the eventual stall verdict to 56 minutes against a
   * 30-minute `--stall-minutes`, because restarting the clock discards however much silence had
   * already been observed, however large — see `watch-loop.test.ts`'s GX1 test. */
  noLogSince: { key: string | null; sinceMs: number } | null;
}

/** The tick's raw signal read, carried alongside the pure `WatchdogObservation` purely so the
 * loop can surface `finalLineUnparseable` into `events.jsonl` (carried-forward requirement 1)
 * without widening `WatchdogObservation`'s own shape — that type is `decide()`'s pure input
 * contract, and `finalLineUnparseable` is an observability concern, never a decision input. */
interface ObserveResult {
  observation: WatchdogObservation;
  signalDetail: Record<string, unknown> | null;
}

function observe(config: WatchdogConfig, homeDir: string, io: WatchdogIO, state: LoopState): ObserveResult {
  const nowMs = io.nowMs();
  const runsDir = join(homeDir, 'runs');
  const allRunIds = io.listEntries(runsDir).filter((e) => e.isDir).map((e) => e.name);
  const newestOnDisk = newestRunId(allRunIds);
  // D2: liveness comes from `state.child` (this invocation's own truth) while the observed run
  // came from whatever directory happened to be newest on disk — and for the 63-170 ms it takes
  // a real forked runner to create its own directory those two name DIFFERENT runs. Whenever we
  // own a live child, a directory that predates its spawn is not it: report the run as
  // not-yet-visible (`runId === null`, the same state the C1 fix below already handles for an
  // empty runs/ directory) rather than attributing the previous run's silence to this one.
  //
  // FIX F1 (fix round 1): while we own a live child, "not it" is now decided by IDENTITY
  // (`newestRunIdExcluding` against every id present at spawn time), never by ordering the
  // single newest id on disk against the single id that predated the spawn — the ordering
  // comparison stayed pinned false forever whenever some OTHER, unrelated directory already on
  // disk sorted lexicographically above the new child's own id (see `select.ts`'s doc comment
  // on `newestRunIdExcluding`). The non-owned path is UNCHANGED: `newestOnDisk` exactly as
  // before.
  const ownsLiveChild = state.child !== null && state.ownedExitCode === null;
  const runId = ownsLiveChild
    ? newestRunIdExcluding(allRunIds, state.priorRunIds)
    : newestOnDisk;

  let record: Record<string, unknown> | null = null;
  if (runId !== null) {
    const raw = io.readFile(join(runsDir, runId, 'run.json'));
    if (raw !== '') {
      try {
        record = JSON.parse(raw) as Record<string, unknown>;
      } catch (err) {
        // A run.json caught mid-write is "no record yet", never a crash of the watchdog.
        if (!(err instanceof SyntaxError)) throw err;
      }
    }
  }

  const recordPid = typeof record?.['pid'] === 'number' ? (record['pid'] as number) : null;
  const recordEndedAt = typeof record?.['endedAt'] === 'string' ? (record['endedAt'] as string) : null;
  const recordExitCode = typeof record?.['exitCode'] === 'number' ? (record['exitCode'] as number) : null;

  // `run.json` — written by the runner itself on exit — is the ground truth for whether a
  // pass has finished, independent of whether THIS process has gotten around to collecting a
  // `waitFor()` result yet: a child we own is alive until we have directly captured its own
  // exit via `waitFor()` (`state.ownedExitCode`) — never inferred from a record that might
  // belong to a DIFFERENT attempt (see C1's history below) — and a run.json with `endedAt:
  // null` that we did NOT spawn (adopted from an earlier watchdog invocation) is legitimately
  // alive even though its pid may be unrecoverable — carried-forward requirement 3's shape.
  //
  // FIX S2 (audit round, final): `recordEndedAt === null` alone is NOT liveness — a SIGKILLed
  // process never gets to write its own finalization, so an unfinalized record with a KNOWN,
  // confirmed-dead pid must not read as alive (it used to, reading "alive" until the unrelated
  // `--stall-minutes` timeout eventually fired). An UNKNOWN pid (`null` — unrecoverable, never
  // fabricated) is not evidence of anything and still trusts `endedAt === null` as before
  // (carried-forward requirement 3's whole point).
  const recordConfirmedDeadPid = recordPid !== null && !io.isProcessAlive(recordPid);
  const recordNotFinalized = record !== null && recordEndedAt === null && !recordConfirmedDeadPid;

  // FIX S1 (audit round, final): a record's FINALIZED (`endedAt` set) exit code may only
  // resolve `lastExitCode` once THIS invocation has actually seen that same `runId` running —
  // either because we spawned it ourselves, or because we adopted it while it was still alive
  // (`recordNotFinalized` above). A record whose FIRST sighting this invocation is already
  // terminal belongs to some earlier watchdog invocation's campaign home and must never gate
  // this tick's decision — that is D74-7's "no prior run THIS invocation" launch case, and
  // reading it anyway is exactly why an answered escalation (or any finished campaign) could
  // never be re-triggered in the same home. Deletes the old pid-matching
  // `recordBelongsToOwnedChild` / three-clause `childAlive` complexity: `childAlive` no longer
  // needs to special-case "is this record's pid actually MY child's pid", because it never
  // consults the record at all — only `state.child`/`state.ownedExitCode`, which are always
  // this invocation's own truth regardless of what stale directory happens to be newest on
  // disk mid-relaunch (C1's original race).
  if (runId !== null && (state.child !== null || recordNotFinalized)) {
    state.trackedRunId = runId;
  }
  // FIX F-C4 (audit round 2, CRITICAL — corrects the comment this replaces): exit codes 1 (lock
  // refused) and 3 (recoverable: crash/quota/overload) are DELIBERATELY still read from a
  // record this invocation never watched — the log's own quota/overload content is re-parsed
  // fresh every tick regardless of provenance, and the cross-invocation `--once` re-check
  // `quota_wait_pending`/`overload_backoff_pending` exists to serve exactly that (spec §9.5;
  // `watch-loop.test.ts`'s "C3: --once publishes nextWakeAt" tests pin it). The comment this
  // replaces claimed reading one "costs at most one bounded extra retry" and "can never
  // reproduce the terminal-code lockup" — BOTH FALSE: with no quota/overload signal at all, an
  // untracked finalized record used to fall straight through to the PLAIN relaunch fallback
  // below (section 3/4 of `decide()`), phantom-spending the ONE crashRelaunches/lockRelaunches
  // budget on an event this invocation never experienced — so a GENUINE crash/lock-conflict
  // later in THIS SAME invocation found the budget already gone and escalated instead of
  // retrying (`watch-loop.test.ts`'s "FIX F-C4" tests reproduce both the exit-3 and exit-1
  // shape). The fix is `lastExitCodeProvenanced` below: it does NOT change what `lastExitCode`
  // itself may read (still self-correcting, still needed for the quota/overload continuation
  // above) — it gates ONLY the two "no other signal" plain-relaunch fallbacks in `decide()`,
  // which is the one place an unprovenanced read was ever unsafe.
  const recordExitCodeSelfCorrects = recordExitCode === 1 || recordExitCode === 3;
  const recordProvenanceMatches = runId !== null && runId === state.trackedRunId;
  const thisInvocationsFinalizedRecord = recordEndedAt !== null
    && (recordExitCodeSelfCorrects || recordProvenanceMatches);

  const childAlive = ownsLiveChild;
  const recordAlive = recordNotFinalized;
  const alive = childAlive || recordAlive;
  const runnerPid = childAlive ? (state.child as RunnerHandle).pid : recordPid;
  // FIX F-C5 (audit round 2, carried forward from S2): a dead-pid-confirmed, unfinalized record
  // is independently validated THIS tick (a fresh `io.isProcessAlive` probe), never inferred
  // from provenance — so it counts as provenanced too, exactly like an owned exit code.
  const crashSuspected = runId !== null && !alive && recordEndedAt === null
    && state.ownedExitCode === null;
  // FIX F-C4: whether `lastExitCode` (below) is evidence THIS invocation actually experienced a
  // crash/lock-refusal worth spending a relaunch budget on — as opposed to merely being
  // self-corrected from a record this invocation never tracked (above). See `model.ts`'s doc
  // comment on `WatchdogObservation.lastExitCodeProvenanced` for what this gates.
  const lastExitCodeProvenanced = state.ownedExitCode !== null
    || crashSuspected
    || (recordEndedAt !== null && recordProvenanceMatches);

  const logs = runId === null ? [] : io.listEntries(join(runsDir, runId, 'logs')).filter((e) => !e.isDir);
  const newest = newestLog(logs.map((e) => ({ name: e.name, mtimeMs: e.mtimeMs })));
  const newestLogPath = newest === null || runId === null ? null : join(runsDir, runId, 'logs', newest.name);

  // FIX F-C5 (audit round 2, Important): a run that dies before writing its first log line used
  // to read as "never stale" forever — `select.ts`'s `isStale()` returned `false` unconditionally
  // whenever `mtimeMs === null`, and a bare `io.isProcessAlive` probe (`recordConfirmedDeadPid`
  // above) has no defence against the OS reusing that pid for an unrelated live process either —
  // both doors led to the SAME unbounded `attach` loop (a reviewer reproduced it running until
  // `RangeError: Out of memory`). See `LoopState.noLogSince`'s own comment for why this tracks
  // THIS invocation's own clock rather than the record's `startedAt`.
  // GX1 (fix round 3): a scalar `ownsLiveChild ? attempt : runId` key restarts the clock on
  // EITHER of two transitions this run can pass through mid-supervision — `runId` going
  // null -> known (the directory finally appearing) and `ownsLiveChild` going true -> false (our
  // own child's exit is captured while its record stays unfinalized and its pid still reads
  // alive) — but only the first was ever meant to be absorbed; a reset on the second discards
  // however much silence had already accumulated (see `LoopState.noLogSince`'s GX1 comment). The
  // supervision identity that must survive BOTH transitions is "is this a run THIS invocation
  // spawned", which `state.priorRunIds` (populated once, at spawn time, in `spawnRunnerNow`)
  // answers without depending on `ownsLiveChild` at all: a run we spawned is one whose id is
  // either not yet knowable (`runId === null`) or was not already on disk before we spawned it.
  // `state.attempt > 0` excludes the adopted-on-start case (attempt 0, never spawned by us),
  // which must keep keying on the run id exactly as the pre-card code did.
  const ourOwnRun = state.attempt > 0 && (runId === null || !state.priorRunIds.has(runId));
  const silenceKey = ourOwnRun ? `attempt-${state.attempt}` : runId;
  if (alive && newest === null) {
    if (state.noLogSince === null || state.noLogSince.key !== silenceKey) {
      state.noLogSince = { key: silenceKey, sinceMs: nowMs };
    }
  } else {
    state.noLogSince = null;
  }
  // `io.readTail` (adapters/watchdog-io.adapter.ts) is the RAW byte-bounded primitive, fed
  // straight to the parser with no wrapping: it reads to the file's true EOF, so the tail's
  // final line is always complete, and the only possible cut is a truncated LEADING line when
  // the window's start falls mid-file — which `parseSessionSignals` tolerates BY DESIGN (a line
  // that fails to parse is simply skipped). `LOG_TAIL_BYTES` is floored at 64 KiB rather than
  // let smaller because a window narrower than one log line would read back `''` and produce
  // "no signal" with no `finalLineUnparseable` flag either — indistinguishable from "window too
  // small" from "genuinely nothing to report", which this floor rules out.
  const signals = newestLogPath === null
    ? null
    : parseSessionSignals(io.readTail(newestLogPath, LOG_TAIL_BYTES));

  const lock = io.readLock();

  const observation: WatchdogObservation = {
    nowMs,
    mode: config.mode,
    stopFilePresent: io.fileExists(join(homeDir, 'STOP')),
    lockHolder: lock === null ? null : { pid: lock.pid, alive: io.isProcessAlive(lock.pid) },
    // C1 (group-C audit round 1, class `critical`): `runId === null` used to mean "nothing has
    // run yet" unconditionally, discarding `childAlive` entirely — but a child this process
    // JUST spawned and still holds (`childAlive`) is a live runner even before its
    // `runs/<id>/` directory has had real wall-clock time to appear. Reporting `run: null`
    // here made `decide()` read "nothing has run yet" and re-launch a SECOND child
    // synchronously, unboundedly, on every cold `--follow` launch. `runId` itself stays
    // legitimately unknown (`null`) until the directory is observed — decide() never reads
    // `runId`, only `alive`/`runnerPid`, so this loses no decision-relevant information.
    run: (runId === null && !childAlive) ? null : {
      runId,
      runnerPid,
      alive,
      endedAt: recordEndedAt,
      newestLogPath,
      newestLogMtimeMs: newest?.mtimeMs ?? null,
      // FIX F-C5: `null` unless this run is CURRENTLY alive with no log line at all — see
      // `LoopState.noLogSince`'s comment for why this is this invocation's own observation
      // clock, never the record's `startedAt`.
      noLogSinceMs: state.noLogSince?.sinceMs ?? null,
    },
    lastExitCode: state.ownedExitCode ?? (thisInvocationsFinalizedRecord ? recordExitCode : null),
    // FIX F-C4: see `lastExitCodeProvenanced` above for what this gates in `decide()`.
    lastExitCodeProvenanced,
    crashSuspected,
    quota: signals?.quota ?? null,
    overload: signals?.overload ?? null,
    counters: state.counters,
    limits: {
      stallMinutes: config.stallMinutes,
      maxQuotaWaits: config.maxQuotaWaits,
      maxOverloadBackoffs: config.maxOverloadBackoffs,
      maxCrashRelaunches: config.maxCrashRelaunches,
      quotaGraceSeconds: config.quotaGraceSeconds,
    },
    fallbackModel: config.fallbackModel,
    pendingWait: state.pendingWait,
  };

  const signalDetail = signals === null ? null : {
    quota: signals.quota,
    overload: signals.overload,
    finalLineUnparseable: signals.finalLineUnparseable ?? false,
  };

  return { observation, signalDetail };
}

export async function runWatchdog(
  config: WatchdogConfig,
  homeDir: string,
  io: WatchdogIO,
): Promise<WatchdogTerminal> {
  const paths = watchdogPathsOf(homeDir);
  const startedAt = io.now();
  const state: LoopState = {
    child: null, ownedExitCode: null, attempt: 0, model: config.model, runId: null,
    nextWakeAtMs: null, stall: null, runnerCommand: null, trackedRunId: null, pendingWait: null,
    noLogSince: null, priorRunIds: new Set(),
    counters: {
      quotaWaits: 0, overloadBackoffs: 0, crashRelaunches: 0, lockRelaunches: 0,
      fallbackUsed: false,
    },
  };

  io.ensureDir(paths.dir);

  const publish = (
    stateName: string,
    lastAction: string,
    terminal: { status: string; reason: string; exitCode: number } | null,
    runnerPid: number | null,
  ): void => {
    io.writeFileAtomic(paths.status, serializeStatus(buildStatus({
      config: { mode: config.mode },
      pid: io.currentPid(),
      home: homeDir,
      startedAt,
      updatedAt: io.now(),
      state: stateName,
      lastAction,
      runId: state.runId,
      runnerPid,
      runnerCommand: state.runnerCommand,
      counters: state.counters,
      nextWakeAtMs: state.nextWakeAtMs,
      stall: state.stall,
      terminal,
    })));
  };

  // Carried-forward requirement 1: the current tick's raw signal read (including
  // `finalLineUnparseable`), merged into every event this tick records — `null` until the
  // first observation, and whenever no log exists yet to read.
  let currentSignalDetail: Record<string, unknown> | null = null;

  const record = (action: string, detail: Record<string, unknown>): void => {
    io.appendFile(paths.events, serializeEvent({
      at: io.now(), action, detail: { ...detail, signal: currentSignalDetail },
    }));
  };

  // Spec §8: the Monitor loop the skill arms needs something to read within 5 s — so this is
  // the FIRST thing that happens, before any observation, spawn or sleep.
  publish('starting', 'start', null, null);
  record('start', { mode: config.mode, home: homeDir, pollSeconds: config.pollSeconds });

  // G2/G4 (Task 11 integration): a terminal exit that leaves a runner ALIVE behind it
  // (`runner_alive`, `stalled`) must still publish that runner's real pid — a human reading
  // `status.json` (or the G4 wall's own "never kills it" proof) needs the pid to check on it.
  // `runnerPid` defaults to `null` for every OTHER terminal reason, unchanged from before.
  const terminate = (
    status: string, reason: string, exitCode: number, runnerPid: number | null = null,
  ): WatchdogTerminal => {
    publish('terminal', `exit:${status}:${reason}`, { status, reason, exitCode }, runnerPid);
    record('exit', { status, reason, exitCode });
    return { exitCode, status, reason, statusPath: paths.status };
  };

  const spawnRunnerNow = (action: Extract<WatchdogAction, { kind: 'launch' | 'relaunch' }>): void => {
    state.attempt += 1;
    if (action.kind === 'relaunch') {
      if (action.cause === 'crash') state.counters.crashRelaunches += 1;
      if (action.cause === 'lock_free') state.counters.lockRelaunches += 1;
      if (action.model !== null) {
        state.counters.fallbackUsed = true;
        state.model = action.model;
      }
    }
    const stdoutPath = paths.runnerStdout(state.attempt);
    io.ensureDir(dirname(stdoutPath));
    const argv = [
      ...io.runnerCommand(),
      '--repo', config.repoRoot,
      '--model', state.model,
      '--home', homeDir,
      ...config.passthrough,
    ];
    state.runnerCommand = argv;
    // D2, FIX F1: every run directory present at the instant BEFORE this child exists. Read
    // here, and nowhere earlier, because this is the only instant at which the answer is
    // exactly right: anything already on disk cannot belong to a process that does not exist
    // yet. A SET of every id (not just the single newest one) so `newestRunIdExcluding` can
    // answer "did MY directory appear" by membership, immune to how any of these ids sorts.
    state.priorRunIds = new Set(
      io.listEntries(join(homeDir, 'runs')).filter((e) => e.isDir).map((e) => e.name),
    );
    // D2's second sentence: `status.json.runId` and the stall event's log path must name the
    // same run. The id of a run whose directory does not exist yet is not knowable, so the
    // honest value is `null` — publishing the PREVIOUS run's id here is what made status.json
    // corroborate the false stall. It becomes the real id on the first tick that sees it.
    state.runId = null;
    // Task 2: each new attempt starts a clean silence clock — the PREVIOUS attempt's
    // `noLogSince` (keyed on its own attempt id or run id) must never be read as this attempt's.
    state.noLogSince = null;
    state.child = io.spawnRunner(argv, { cwd: config.repoRoot, stdoutPath });
    state.ownedExitCode = null;
    state.nextWakeAtMs = null;
    // FIX F-C1/F-C2: any new attempt (launch OR relaunch, whatever its cause) starts a fresh
    // cycle — a wait ordered for a PREVIOUS attempt's signal must never be read as "served" by
    // some later, unrelated signal.
    state.pendingWait = null;
  };

  for (;;) {
    const { observation, signalDetail } = observe(config, homeDir, io, state);
    currentSignalDetail = signalDetail;
    state.runId = observation.run?.runId ?? state.runId;
    const action = decide(observation);
    io.printLine(actionLine(action));

    switch (action.kind) {
      case 'launch':
      case 'relaunch': {
        record(action.kind, {
          cause: action.kind === 'relaunch' ? action.cause : 'initial',
          model: action.kind === 'relaunch' ? action.model : null,
        });
        spawnRunnerNow(action);
        publish('runner_running', actionLine(action), null, state.child?.pid ?? null);
        if (config.mode === 'once') {
          return terminate(
            'running', action.kind === 'launch' ? 'launched' : 'relaunched', 11,
            state.child?.pid ?? null,
          );
        }
        break;
      }

      case 'attach': {
        // FIX F-C3 defense-in-depth: `decide()` must never return `attach` while
        // `config.mode === 'once'` (W-P5, sections 1/3/5 all now mode-gate their lockHolder/
        // live-run attach) — a once-mode tick sleeping even one slice here would break "at most
        // one action, then exit 11" for the cron/launchd caller `--once` exists to serve. This
        // is a should-never-happen backstop, not a reachable path.
        if (config.mode === 'once') {
          throw new Error(
            'watchdog invariant violated: --once reached the attach/sleep path (W-P5); '
              + 'decide() must never return attach while mode is once',
          );
        }
        record('attach', { runnerPid: action.runnerPid });
        publish('runner_running', actionLine(action), null, action.runnerPid);
        if (state.child !== null && state.ownedExitCode === null) {
          state.ownedExitCode = await state.child.waitFor(config.pollSeconds * 1000);
        } else {
          // The pid is unknown, or this is not a process we own (carried-forward requirement
          // 3): never poll or signal a pid — including never a fabricated pid 0 — and never
          // launch a second runner. Wait a bounded slice, then re-observe through run.json /
          // the lock file on the next tick, exactly like the wait_until wake-up loop below.
          await io.sleep(config.pollSeconds * 1000);
        }
        break;
      }

      case 'wait_until': {
        if (action.cause === 'quota') state.counters.quotaWaits += 1;
        else state.counters.overloadBackoffs += 1;
        state.nextWakeAtMs = action.untilMs;
        // FIX F-C1/F-C2: remember this wait's deadline so the NEXT observation can tell
        // "already served" from "a fresh occurrence" — cleared by `spawnRunnerNow` the moment
        // it is consumed by a relaunch (or superseded by any other new attempt).
        state.pendingWait = { cause: action.cause, untilMs: action.untilMs };
        record('wait_until', { cause: action.cause, untilMs: action.untilMs });
        publish(action.cause === 'quota' ? 'quota_wait' : 'overload_backoff', actionLine(action), null, null);
        // A wake-up LOOP, never one long sleep (spec §2.1 Never): a STOP file or a manual
        // relaunch is noticed within one slice, and nextWakeAt stays published throughout.
        while (io.nowMs() < action.untilMs) {
          const slice = Math.min(action.untilMs - io.nowMs(), config.pollSeconds * 1000);
          record('wait_slice', { ms: slice, remainingMs: action.untilMs - io.nowMs() });
          await io.sleep(slice);
          publish(action.cause === 'quota' ? 'quota_wait' : 'overload_backoff', actionLine(action), null, null);
          if (io.fileExists(join(homeDir, 'STOP'))) break;
        }
        state.nextWakeAtMs = null;
        break;
      }

      case 'stall': {
        state.stall = action.logPath === null || action.lastMtimeMs === null
          ? null
          : { logPath: action.logPath, lastMtimeMs: action.lastMtimeMs };
        record('stall', { logPath: action.logPath, lastMtimeMs: action.lastMtimeMs });
        return terminate(
          action.exit.status, action.exit.reason, action.exit.status === 'needs_human' ? 10 : 11,
          observation.run?.runnerPid ?? null,
        );
      }

      case 'exit':
        // C3: carry the once-mode pending exit's wake instant (if any) through to the
        // published status BEFORE terminate()'s own publish() reads `state.nextWakeAtMs` —
        // every other exit reason leaves `nextWakeAtMs` undefined, so this is a no-op there.
        state.nextWakeAtMs = action.nextWakeAtMs ?? null;
        return terminate(action.status, action.reason, exitCodeOf(action), observation.run?.runnerPid ?? null);
    }
  }
}
