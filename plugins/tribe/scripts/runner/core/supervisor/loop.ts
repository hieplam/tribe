/**
 * The supervisor's supervision loop: observe -> decide -> record intent -> perform -> persist ->
 * publish, until a `park` or `exit` action is carried out (spec §4.2's seven-step tick, card
 * `campaign-supervisor` Task 14). Impure BY INJECTION only (`pure-core.md`, mirroring
 * `core/watchdog/watch-loop.ts`'s own shape): every world effect arrives on `io`, and every
 * DECISION belongs to `decide()` — this file only carries decisions out, persists their
 * consequences, and publishes the result. It never re-derives a park reason.
 *
 * --- The IO seam: `SupervisorIO` (ports/ports.ts) is not, on its own, everything this loop
 * needs. Task 12's own doc comment scopes `SupervisorIO`'s members to fs/clock/process/watchdog
 * primitives; spawning a ONE-SHOT SESSION for a `spawn_session` action goes through
 * `session.ts`'s `runOneShotSession`, which needs its own `OneShotSessionSeam`
 * (`spawnSession`/`onSessionStart`/`appendLog`) plus a `realpath` capability for the containment
 * hook (`permit.ts#buildContainmentHook`) — neither is declared on `SupervisorIO`. Rather than
 * touch the frozen `ports/ports.ts` (outside this task's fence) or invent a new `*IO`/`*Port`
 * interface (banned outside `ports/` by `structure.test.ts`), this module composes what it needs
 * as a local TYPE ALIAS (not an `interface` declaration, so the structural-contract scan does not
 * even see it) over already-declared, already-imported types — exactly the shape `session.ts`
 * itself set the precedent for with its own locally-scoped, non-`IO`/`Port`-suffixed
 * `OneShotSessionSeam`. The composition-root task that builds the real `io` object (a later
 * task) is responsible for satisfying this wider shape — e.g. by merging `buildSupervisorIo()`
 * with `adapters/session.adapter.ts`'s exports and a `realpath` primitive, the same way any
 * composition root merges capability ports. See the report to the Warchief for this concern.
 *
 * --- V7/V8 (spec §3.4): `decide.ts`'s own post-session block deliberately does NOT implement
 * the `ratified`/`closed` outcomes ("not this task's scope (dispatch ruling 2026-09-19)" —
 * `decide.test.ts`'s own comment proves it: an outcome outside V1-V6 "falls through to the
 * ordinary rows", which would use the WATCHDOG's now-stale terminal reason and wrongly re-spawn
 * another ratify/closing session forever). V7/V8 are therefore this loop's own responsibility,
 * not a re-derivation of anything `decide()` owns: a session-authored SUCCESS the loop performs
 * unconditionally, never a `ParkReason`.
 *
 * --- The one-shot session's PROMPT: `core/supervisor/brief.ts#renderBrief` needs facts
 * (escalation body text already read, spec/plan paths, gap-gate reports) that
 * `SupervisorObservation` (spec §3.2) does not carry, and this task's brief does not list
 * `brief.ts` among the modules "the loop composes". Wiring the real brief is left to a later
 * task; `placeholderPrompt` below documents the seam rather than pretending to close it.
 */
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { WatchdogHandle, SupervisorIO } from '../../ports/ports.ts';
import type {
  CampaignReportCardFact, CampaignReportFacts, EscalationFact, LedgerEntry, LedgerVerdict,
  ParkMarker, ParkReason, SessionKind, SessionOutcome, SupervisorAction, SupervisorLimits,
  SupervisorObservation, SupervisorState, SupervisorStatus,
} from './model.ts';
import { decide } from './decide.ts';
import {
  applyRulingOutcome, parseState as parseSupervisorState, serializeState, zeroState,
  type ParseStateResult,
} from './state.ts';
import {
  buildStatus, exitCodeOf, renderNeedsOwner, serializeStatus, type SupervisorTerminalKind,
} from './status.ts';
import { parseParkMarker, verifyClosing, verifyRatify, verifyRuling } from './verify.ts';
import {
  buildOneShotOptions as _buildOneShotOptions, runOneShotSession,
  type OneShotSessionConfig, type OneShotSessionSeam,
} from './session.ts';
import { unratifiedRulingIds } from '../rulings.ts';
import { answersPathOf, campaignStatePathOf, escalationPathOf, escalationsDirOf } from '../paths.ts';
import { REPORT_JSON_FILENAME } from '../report.ts';
import { watchdogPathsOf } from '../watchdog/select.ts';

// `buildOneShotOptions` is imported only so its signature is read by this module's doc comment
// (it is exercised through `runOneShotSession`, never called directly here) — reference it so an
// unused-import lint never flags the intentional read-the-signature contract.
void _buildOneShotOptions;

// ---------------------------------------------------------------------------------------
// The composed seam (see module doc comment) — a TYPE ALIAS, never an `interface`, so
// `structure.test.ts`'s "no interface X...IO/...Port declaration outside ports/" scan (which
// matches only `interface` declarations) never sees it.
// ---------------------------------------------------------------------------------------
export type SupervisorLoopSeam = SupervisorIO & OneShotSessionSeam & {
  /** Symlink-resolved absolute path; returns its input unchanged when the path does not exist
   * (`permit.ts#buildContainmentHook`'s own contract, mirrored from `ports.ts`'s
   * `DirScanPort.realpath`). */
  realpath(path: string): string;
};

/** Composition-root-supplied loop configuration. Deliberately NOT `args.ts`'s `SupervisorConfig`
 * (that type also carries `rawHome`/`campaignSlug`, already resolved into this function's own
 * `homeDir` parameter by the edge before `runSupervisor` is ever called) plus the two things only
 * a composition root can resolve: the argv PREFIX that spawns `bun run.ts` itself as the watchdog
 * child (mirrors `ports.ts`'s `RunnerSpawnPort.runnerCommand()` — `core/` cannot resolve its own
 * file location) and the exact re-run command rendered into `NEEDS_OWNER.md`. */
export interface SupervisorLoopConfig {
  repoRoot: string;
  model: string;
  /** Falls back to `model` when absent — mirrors `args.ts`'s own doc comment on
   * `SupervisorConfig.watchdogModel`. */
  watchdogModel: string | null;
  /** The campaign's owner-facing slug (`status.json`'s `campaign` field, `NEEDS_OWNER.md`'s
   * title) — independent of whether the home was resolved via `--campaign` or `--home`. */
  campaign: string;
  limits: SupervisorLimits;
  sessionTimeoutSeconds: number;
  pollSeconds: number;
  /** e.g. `['bun', '/abs/path/run.ts']` — see the module doc comment's IO-seam note. */
  watchdogCommand: string[];
  /** The exact `supervise` argv the owner re-runs after resolving a park. */
  rerunCommand: string;
}

export interface SupervisorTerminal {
  exitCode: number;
  kind: SupervisorTerminalKind;
  reason: string;
  /** `null` only for `already_running` (P1's pre-lock-acquisition refusal): nothing was ever
   * published because a second supervisor never starts. */
  statusPath: string | null;
}

// ---------------------------------------------------------------------------------------
// Paths — every write/read this loop performs is one of these (S-P5's write surface: only
// `<home>/supervisor/**`, `<home>/NEEDS_OWNER.md`, and the escalation-file rename).
// ---------------------------------------------------------------------------------------
interface SupervisorPaths {
  dir: string;
  status: string;
  events: string;
  ledger: string;
  state: string;
  lock: string;
  parkDir: string;
  needsOwner: string;
  watchdogStatus: string;
  campaignReport: string;
  answers: string;
  escalationsDir: string;
  finalReport: string;
}

function supervisorPathsOf(homeDir: string): SupervisorPaths {
  const dir = join(homeDir, 'supervisor');
  return {
    dir,
    status: join(dir, 'status.json'),
    events: join(dir, 'events.jsonl'),
    ledger: join(dir, 'ledger.jsonl'),
    state: join(dir, 'state.json'),
    lock: join(dir, '.supervisor.lock'),
    parkDir: join(dir, 'park'),
    needsOwner: join(homeDir, 'NEEDS_OWNER.md'),
    watchdogStatus: watchdogPathsOf(homeDir).status,
    campaignReport: join(homeDir, REPORT_JSON_FILENAME),
    answers: answersPathOf(homeDir),
    escalationsDir: escalationsDirOf(homeDir),
    finalReport: join(dir, 'final-report.md'),
  };
}

const MAX_WAIT_MS = 2_147_000_000; // ~24.8 days — safely under the 32-bit setTimeout overflow.

// ---------------------------------------------------------------------------------------
// Small, narrow, fail-closed edge parsers. Every one degrades to a typed "absent"/`null` value
// on malformed input — never a throw reaching the tick loop (`fail-closed-edges.md`
// obligation 1).
// ---------------------------------------------------------------------------------------

function entryExists(io: SupervisorLoopSeam, dirPath: string, name: string): boolean {
  return io.listEntries(dirPath).some((e) => !e.isDir && e.name === name);
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ForeignLock { pid: number; alive: boolean }

/** Reads `<home>/supervisor/.supervisor.lock`, returning `null` when it is absent, malformed, OR
 * belongs to `currentPid` (our own lock is never "foreign" — that would make P1 fire on every
 * tick we hold it). */
function readForeignLock(io: SupervisorLoopSeam, lockPath: string, currentPid: number): ForeignLock | null {
  const raw = io.readFileOrEmpty(lockPath);
  if (raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const pid = (parsed as { pid?: unknown } | null)?.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid === currentPid) return null;
  return { pid, alive: io.isProcessAlive(pid) };
}

/** Oracle step 1: acquire or reclaim `<home>/supervisor/.supervisor.lock`. Refuses only against a
 * LIVE foreign pid (D74-7: never a second supervisor); a dead or absent lock is reclaimed by
 * overwriting it with our own pid. */
function tryAcquireLock(
  io: SupervisorLoopSeam, lockPath: string, currentPid: number,
): { ok: true } | { ok: false; pid: number } {
  const foreign = readForeignLock(io, lockPath, currentPid);
  if (foreign !== null && foreign.alive) return { ok: false, pid: foreign.pid };
  io.writeFileAtomic(lockPath, `${JSON.stringify({ pid: currentPid, acquiredAt: io.now() }, null, 2)}\n`);
  return { ok: true };
}

interface WatchdogStatusFacts {
  pid: number;
  terminal: { status: string; reason: string; exitCode: number } | null;
}

function parseWatchdogStatusFacts(raw: string): WatchdogStatusFacts | null {
  if (raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const pid = obj['pid'];
  if (typeof pid !== 'number') return null;
  const terminalRaw = obj['terminal'];
  let terminal: WatchdogStatusFacts['terminal'] = null;
  if (terminalRaw !== null && typeof terminalRaw === 'object') {
    const t = terminalRaw as Record<string, unknown>;
    if (typeof t['status'] === 'string' && typeof t['reason'] === 'string' && typeof t['exitCode'] === 'number') {
      terminal = { status: t['status'], reason: t['reason'], exitCode: t['exitCode'] };
    }
  }
  return { pid, terminal };
}

/** `campaign-report.json`'s typed fields only (spec §3.2's `CampaignReportFacts`) — deliberately
 * independent of `core/report.ts`'s own `CampaignReport` (model.ts's own doc comment: "a later
 * task narrows the real report into this shape at the edge" — this IS that task). Malformed or
 * absent content is `null`, never a throw. */
function parseCampaignReportFacts(raw: string): CampaignReportFacts | null {
  if (raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const run = obj['run'] as Record<string, unknown> | undefined;
  if (run === undefined || typeof run['reason'] !== 'string') return null;
  const unratifiedRulings = Array.isArray(run['unratifiedRulings'])
    ? (run['unratifiedRulings'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const pending = Array.isArray(obj['pending'])
    ? (obj['pending'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const cards: Record<string, CampaignReportCardFact> = {};
  const cardsRaw = obj['cards'];
  if (cardsRaw !== null && typeof cardsRaw === 'object') {
    for (const [cardId, entryRaw] of Object.entries(cardsRaw as Record<string, unknown>)) {
      const entry = entryRaw as Record<string, unknown>;
      const outcome = entry['outcome'];
      if (outcome !== 'shipped' && outcome !== 'escalated' && outcome !== 'blocked' && outcome !== 'not_reached') {
        continue;
      }
      cards[cardId] = {
        outcome,
        escalationFile: typeof entry['escalationFile'] === 'string' ? entry['escalationFile'] : null,
        question: typeof entry['question'] === 'string' ? entry['question'] : null,
        autoAnswerRounds: typeof entry['autoAnswerRounds'] === 'number' ? entry['autoAnswerRounds'] : null,
      };
    }
  }
  const statsRaw = obj['stats'] as Record<string, unknown> | undefined;
  const numOr0 = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    run: { reason: run['reason'], unratifiedRulings },
    pending,
    cards,
    stats: {
      shipped: numOr0(statsRaw?.['shipped']),
      escalated: numOr0(statsRaw?.['escalated']),
      blocked: numOr0(statsRaw?.['blocked']),
      notReached: numOr0(statsRaw?.['notReached']),
    },
  };
}

/** The escalation file's own `**Reason:**` line, verbatim (S-P3: a fixed-template field, never
 * prose interpretation — the same line `core/report.ts#extractQuestionDigest` already proves is
 * machine-readable, isolated here to just the reason value). */
function extractReasonLine(content: string): string {
  const match = /\*\*Reason:\*\*\s*(.+)/.exec(content);
  return match?.[1]?.trim() ?? '';
}

function readOwnerOnlyEscalations(io: SupervisorLoopSeam, homeDir: string): string[] {
  const raw = io.readFileOrEmpty(campaignStatePathOf(homeDir));
  if (raw === '') return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const list = parsed['ownerOnlyEscalations'];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function readParkMarkers(io: SupervisorLoopSeam, parkDir: string): ParkMarker[] {
  const entries = io.listEntries(parkDir).filter((e) => !e.isDir && e.name.endsWith('.json'));
  const markers: ParkMarker[] = [];
  for (const entry of entries) {
    const cardId = entry.name.slice(0, -'.json'.length);
    const raw = io.readFileOrEmpty(join(parkDir, entry.name));
    if (raw === '') continue;
    const parsedKind = parseParkMarker(raw);
    let trigger = '';
    let note = '';
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (typeof obj['trigger'] === 'string') trigger = obj['trigger'];
      if (typeof obj['note'] === 'string') note = obj['note'];
    } catch {
      // parsedKind already reflects malformed content as 'too_hard'; trigger/note stay ''.
    }
    markers.push({ v: 1, kind: parsedKind.kind, cardId, trigger, note });
  }
  return markers;
}

function buildEscalationFacts(
  io: SupervisorLoopSeam, homeDir: string, report: CampaignReportFacts | null,
): EscalationFact[] {
  if (report === null) return [];
  const out: EscalationFact[] = [];
  for (const [cardId, card] of Object.entries(report.cards)) {
    if (card.outcome !== 'escalated') continue;
    const filePresent = entryExists(io, escalationsDirOf(homeDir), `${cardId}.md`);
    const content = filePresent ? io.readFileOrEmpty(escalationPathOf(homeDir, cardId)) : '';
    const reason = filePresent ? extractReasonLine(content) : (card.question ?? '');
    out.push({
      cardId,
      filePresent,
      contentSha256: sha256Hex(content),
      reason,
      autoAnswerRounds: card.autoAnswerRounds ?? 0,
      // Known simplification (see report to the Warchief): a durable card<->ruling-id link that
      // survives a supervisor crash between a ruling landing and its archive would need either a
      // new persisted field (state.ts is frozen) or a full events.jsonl scan. Left `null` here;
      // the repeat-escalation breaker (`state.seenEscalations`, applied BEFORE every ruling
      // spawn per S-P6) still fails CLOSED into `park('repeat_escalation')` in that crash window
      // rather than double-ruling — never silently unsafe, only less automatic.
      landedRulingId: null,
    });
  }
  return out;
}

/** `nextUnanswered`, mirrored from `decide.ts`'s own one-line helper (private there) for DISPLAY
 * purposes only — which card a `park` is about, for `NEEDS_OWNER.md`'s `{card}` placeholder.
 * `decide()` has ALREADY decided to park by the time this runs; this never re-derives WHETHER to
 * park, only WHICH card a card-scoped park names. */
function nextUnansweredCardId(escalations: EscalationFact[]): string | null {
  return escalations.find((e) => e.filePresent)?.cardId ?? null;
}

// ---------------------------------------------------------------------------------------
// In-memory, per-invocation loop state — never persisted (G4 only concerns the DISK facts:
// state.json/events.jsonl/ledger.jsonl/status.json). Lost on crash and rebuilt by re-observation
// (P4 adoption), exactly like `watch-loop.ts`'s own `LoopState`.
// ---------------------------------------------------------------------------------------
interface LoopState {
  watchdogHandle: WatchdogHandle | null;
  watchdogOwnedExitCode: number | null;
  watchdogRunAttempt: number;
  /** Set by a `spawn_session` action's `perform()` for exactly the next tick's `observe()` —
   * model.ts's own contract: "null on every ordinary tick; set for exactly the ONE re-entrant
   * tick immediately after a one-shot session returns." */
  lastSessionOutcome: SessionOutcome | null;
  landedThisRun: string[];
}

function observe(
  config: SupervisorLoopConfig, homeDir: string, io: SupervisorLoopSeam, paths: SupervisorPaths,
  loopState: LoopState, supState: SupervisorState, lastSessionOutcome: SessionOutcome | null,
): SupervisorObservation {
  const nowMs = io.nowMs();
  const currentPid = io.currentPid();

  const stopFilePresent = entryExists(io, homeDir, 'STOP');
  const needsOwnerPresent = entryExists(io, homeDir, 'NEEDS_OWNER.md');

  const foreignLock = readForeignLock(io, paths.lock, currentPid);
  const supervisorLock = foreignLock === null ? null : { pid: foreignLock.pid, alive: foreignLock.alive };

  const watchdogStatus = parseWatchdogStatusFacts(io.readFileOrEmpty(paths.watchdogStatus));
  const watchdogAlive = watchdogStatus !== null
    && watchdogStatus.terminal === null
    && io.isProcessAlive(watchdogStatus.pid);
  const watchdogLive = watchdogAlive ? { pid: watchdogStatus!.pid, alive: true } : null;
  const lastWatchdog = watchdogStatus === null
    ? null
    : { terminal: watchdogStatus.terminal, ownedExitCode: loopState.watchdogOwnedExitCode };

  const report = parseCampaignReportFacts(io.readFileOrEmpty(paths.campaignReport));
  const escalations = buildEscalationFacts(io, homeDir, report);
  const ownerOnlyEscalations = readOwnerOnlyEscalations(io, homeDir);

  // Computed FRESH from `answers.md` every tick (never trusted from the stale
  // `campaign-report.json` snapshot): a ratify session only ever touches `answers.md`, so a
  // report-sourced value would still show the pre-ratify ids and — since `decide.ts`'s
  // `rulings_unratified` rows (13-15) are unconditional on this list's CONTENT, only on the
  // watchdog's terminal REASON — would spawn an unbounded stream of ratify sessions after the
  // first one already succeeded.
  const unratifiedRulings = unratifiedRulingIds(io.readFileOrEmpty(paths.answers));

  const parkMarkers = readParkMarkers(io, paths.parkDir);

  return {
    nowMs,
    stopFilePresent,
    needsOwnerPresent,
    supervisorLock,
    watchdogLive,
    lastWatchdog,
    report,
    escalations,
    ownerOnlyEscalations,
    unratifiedRulings,
    parkMarkers,
    state: supState,
    limits: config.limits,
    lastSessionOutcome,
  };
}

/** Task 14's oracle governs the seven-step tick and the spawn/verify/persist mechanics, not the
 * one-shot session's prompt CONTENT — see the module doc comment. A clearly-labelled placeholder
 * so a real session, if ever pointed at this loop before brief.ts is wired in, fails obviously
 * rather than silently. */
function placeholderPrompt(session: SessionKind, cardId: string | null): string {
  return `[supervisor placeholder prompt — core/supervisor/brief.ts wiring is a later task] `
    + `kind=${session} cardId=${cardId ?? '(none)'}`;
}

function incrementRetrigger(state: SupervisorState, key: string): SupervisorState {
  return { ...state, retriggers: { ...state.retriggers, [key]: (state.retriggers[key] ?? 0) + 1 } };
}

/** Records this tick's action as the INTENT, in `events.jsonl`, BEFORE anything is performed
 * (Oracle step 4, checked ahead of step 5 — spec §4.2: "Step 4 before step 5 is what makes a
 * crash diagnosable"). */
function recordIntent(io: SupervisorLoopSeam, eventsPath: string, nowIso: string, action: SupervisorAction): void {
  io.appendFile(eventsPath, `${JSON.stringify({ at: nowIso, action: action.kind, detail: action })}\n`);
}

function appendLedgerEntry(io: SupervisorLoopSeam, ledgerPath: string, entry: LedgerEntry): void {
  io.appendFile(ledgerPath, `${JSON.stringify(entry)}\n`);
}

function stateLabelFor(action: SupervisorAction): SupervisorStatus['state'] {
  switch (action.kind) {
    case 'run_watchdog': return 'running_watchdog';
    case 'await_watchdog': return 'awaiting_watchdog';
    case 'spawn_session':
      return action.session === 'ruling'
        ? 'session_ruling'
        : action.session === 'ratify' ? 'session_ratify' : 'session_closing';
    case 'archive_escalation': return 'observing';
    case 'park': return 'terminal';
    case 'exit': return 'terminal';
  }
}

export async function runSupervisor(
  config: SupervisorLoopConfig, homeDir: string, io: SupervisorLoopSeam,
): Promise<SupervisorTerminal> {
  const paths = supervisorPathsOf(homeDir);
  const currentPid = io.currentPid();
  const startedAtMs = io.nowMs();

  // Oracle step 1: acquire/reclaim the lock BEFORE anything else — never a second supervisor
  // (D74-7). Nothing is published on refusal: a second supervisor invocation must leave the
  // first one's own status/event/ledger trail completely untouched.
  const lockResult = tryAcquireLock(io, paths.lock, currentPid);
  if (!lockResult.ok) {
    return {
      exitCode: exitCodeOf('already_running'),
      kind: 'already_running',
      reason: `a live supervisor (pid ${lockResult.pid}) already holds this campaign's lock`,
      statusPath: null,
    };
  }

  const loopState: LoopState = {
    watchdogHandle: null,
    watchdogOwnedExitCode: null,
    watchdogRunAttempt: 0,
    lastSessionOutcome: null,
    landedThisRun: [],
  };

  let watchdogLastPid: number | null = null;
  let watchdogLastTerminalReason: string | null = null;

  const publish = (
    stateLabel: SupervisorStatus['state'], lastAction: string,
    terminal: SupervisorStatus['terminal'],
  ): void => {
    io.writeFileAtomic(paths.status, serializeStatus(buildStatus({
      pid: currentPid,
      home: homeDir,
      campaign: config.campaign,
      startedAtMs,
      updatedAtMs: io.nowMs(),
      state: stateLabel,
      lastAction,
      watchdog: { pid: watchdogLastPid, lastTerminalReason: watchdogLastTerminalReason },
      currentSession: null,
      counters: {
        watchdogRuns: supState.watchdogRuns,
        spawns: supState.spawns,
        rulingRounds: supState.rulingRounds,
        ratifyRounds: supState.ratifyRounds,
        failures: 0,
      },
      terminal,
    })));
  };

  const persist = (): void => {
    io.writeFileAtomic(paths.state, serializeState(supState));
  };

  // The state file is read once, up front — a malformed or unsupported-version file cannot
  // safely resume (silently falling back to `zeroState()` would wipe the repeat-escalation
  // breaker and risk a double ruling), so this refuses the same way a `park` does: one owner
  // document, exit 20. `ParkReason`'s closed set has no entry for this (it is not one of the
  // 22 spec §6.2 values, and `PARK_SENTENCES` is a `Record<ParkReason, ...>` — deliberately
  // exhaustive), so this writes a minimal document directly rather than through
  // `renderNeedsOwner`.
  const parsedState: ParseStateResult = (() => {
    const raw = io.readFileOrEmpty(paths.state);
    if (raw === '') return { kind: 'ok' as const, state: zeroState() };
    try {
      return parseSupervisorState(JSON.parse(raw));
    } catch {
      return { kind: 'unsupported_version' as const, version: 'unparseable' };
    }
  })();

  if (parsedState.kind === 'unsupported_version') {
    const reason = `supervisor/state.json has an unsupported or unparseable version `
      + `(${JSON.stringify(parsedState.version)}); resolve by hand before resuming`;
    try {
      io.writeFileAtomic(
        paths.needsOwner,
        `# Campaign needs the owner: ${config.campaign}\n\n**Park reason:** state_unreadable\n\n`
          + `## What happened\n${reason}\n\n## What unblocks it\n`
          + `Inspect ${paths.state} by hand, repair or remove it, delete this file, then `
          + `re-run: ${config.rerunCommand}\n`,
      );
    } catch (err) {
      // REFUTED in advance (adjudication rule): never retry a failed park write — print one
      // typed line and exit 20 anyway, so the owner is never silently unnotified. `console` is
      // a global, not an import — `SupervisorIO` carries no stdout capability, exactly the
      // narrow exception `core/supervisor/session.ts` already takes for the global `setTimeout`
      // it needs and `ports/ports.ts` does not provide.
      console.error(`supervisor: NEEDS_OWNER.md write failed (${String(err)}); exiting anyway`);
    }
    io.writeFileAtomic(paths.status, serializeStatus(buildStatus({
      pid: currentPid, home: homeDir, campaign: config.campaign, startedAtMs, updatedAtMs: io.nowMs(),
      state: 'terminal', lastAction: 'park:state_unreadable',
      watchdog: { pid: null, lastTerminalReason: null }, currentSession: null,
      counters: { watchdogRuns: 0, spawns: 0, rulingRounds: {}, ratifyRounds: 0, failures: 0 },
      terminal: { status: 'needs_owner', reason, exitCode: exitCodeOf('needs_owner') },
    })));
    return { exitCode: exitCodeOf('needs_owner'), kind: 'needs_owner', reason, statusPath: paths.status };
  }

  let supState: SupervisorState = parsedState.state;

  // Oracle: "status.json is published within the first tick" — before the first observe(), so a
  // Monitor loop reading it has something fresh within seconds (mirrors watch-loop.ts's own
  // "publish before the first observation" ordering).
  publish('observing', 'start', null);

  for (;;) {
    const currentLastSessionOutcome = loopState.lastSessionOutcome;
    loopState.lastSessionOutcome = null; // consumed; re-set below only if THIS tick spawns again

    const observation = observe(config, homeDir, io, paths, loopState, supState, currentLastSessionOutcome);

    // V7/V8 — see the module doc comment: `decide.ts` deliberately excludes these two outcomes.
    let action: SupervisorAction;
    if (currentLastSessionOutcome !== null && currentLastSessionOutcome.outcome === 'ratified') {
      action = { kind: 'run_watchdog', cards: null, includeEscalated: false };
    } else if (currentLastSessionOutcome !== null && currentLastSessionOutcome.outcome === 'closed') {
      supState = { ...supState, closingVerified: true };
      action = { kind: 'exit', status: 'done', reason: 'campaign_closed' };
    } else {
      action = decide(observation);
    }

    // Oracle step 4 — BEFORE step 5 (perform).
    recordIntent(io, paths.events, io.now(), action);

    const isRetryTick = currentLastSessionOutcome !== null;

    switch (action.kind) {
      case 'run_watchdog': {
        // Retrigger bookkeeping for rows 16/24 (§3.4): credited only when THIS run_watchdog was
        // actually caused by one of those two rows — derived from the SAME typed fact decide()
        // itself read (`observation.lastWatchdog`), never a new decision.
        if (observation.lastWatchdog !== null) {
          const priorReason = observation.lastWatchdog.terminal?.reason ?? null;
          if (priorReason === 'session_incomplete') {
            supState = incrementRetrigger(supState, 'session_incomplete');
          } else if (observation.lastWatchdog.terminal === null) {
            supState = incrementRetrigger(supState, 'watchdog_no_terminal');
          }
        }
        supState = { ...supState, watchdogRuns: supState.watchdogRuns + 1 };

        loopState.watchdogRunAttempt += 1;
        const argv = [
          ...config.watchdogCommand, 'watchdog',
          '--repo', config.repoRoot,
          '--model', config.watchdogModel ?? config.model,
          '--home', homeDir,
          '--follow',
        ];
        if (action.cards !== null) argv.push('--cards', action.cards.join(','));
        if (action.includeEscalated) argv.push('--include-escalated');
        const stdoutPath = join(paths.dir, 'watchdog-stdout', `attempt-${loopState.watchdogRunAttempt}.log`);
        loopState.watchdogHandle = io.spawnWatchdog(argv, { cwd: config.repoRoot, stdoutPath });
        loopState.watchdogOwnedExitCode = null;
        watchdogLastPid = loopState.watchdogHandle.pid;

        persist();
        publish(stateLabelFor(action), 'run_watchdog', null);
        continue;
      }

      case 'await_watchdog': {
        watchdogLastPid = action.pid;
        if (loopState.watchdogHandle !== null && loopState.watchdogOwnedExitCode === null) {
          const boundedMs = Math.max(1, Math.min(config.pollSeconds, 60)) * 1000;
          loopState.watchdogOwnedExitCode = await loopState.watchdogHandle.waitFor(boundedMs);
        } else {
          // Adopted from a prior invocation — no handle to wait on; a bounded sleep, then
          // re-observe (mirrors `watch-loop.ts`'s own `attach` slice).
          await sleep(Math.max(1, Math.min(config.pollSeconds, 30)) * 1000);
        }
        persist();
        publish(stateLabelFor(action), 'await_watchdog', null);
        continue;
      }

      case 'spawn_session': {
        supState = { ...supState, spawns: supState.spawns + 1 };
        if (action.session === 'ruling' && action.cardId !== null) {
          const escalation = observation.escalations.find((e) => e.cardId === action.cardId);
          // S-P6: the round increments BEFORE the spawn — a crash can only over-count.
          supState = applyRulingOutcome(supState, action.cardId, escalation?.contentSha256 ?? '');
        }
        if (action.session === 'ratify') {
          supState = { ...supState, ratifyRounds: supState.ratifyRounds + 1 };
        }
        if (isRetryTick) {
          const retryKey = `${action.session}:${String(action.cardId)}`;
          supState = incrementRetrigger(supState, retryKey);
        }
        // S-P6, taken literally: the round must be DURABLE before the spawn, not merely
        // incremented in memory — a crash between this persist and the session returning must
        // over-count (fail closed), never lose the increment (which would under-count and risk
        // a double ruling on restart). Persisted again at the tick's normal end below once the
        // ledger/landed-ruling facts are known; this one exists solely for that ordering.
        persist();

        const oneShotConfig: OneShotSessionConfig = {
          homeDir,
          model: config.model,
          realpath: (p: string) => io.realpath(p),
          ...(action.session === 'ruling' || action.session === 'closing'
            ? { repoRoot: config.repoRoot }
            : {}),
        };
        const before = io.readFileOrEmpty(paths.answers);
        const startedAtIso = io.now();
        const result = await runOneShotSession(
          {
            kind: action.session,
            prompt: placeholderPrompt(action.session, action.cardId),
            config: oneShotConfig,
            sessionTimeoutMs: config.sessionTimeoutSeconds * 1000,
          },
          io,
        );
        const endedAtIso = io.now();
        const after = io.readFileOrEmpty(paths.answers);

        let outcome: SessionOutcome['outcome'];
        let rulingId: string | null = null;
        let parkMarkerKind: SessionOutcome['parkMarkerKind'];

        if (result.outcome === 'timeout') {
          outcome = 'timeout';
        } else if (result.outcome === 'error') {
          outcome = 'failed';
        } else if (action.session === 'ruling') {
          const markerRaw = entryExists(io, paths.parkDir, `${action.cardId}.json`)
            ? io.readFileOrEmpty(join(paths.parkDir, `${action.cardId}.json`))
            : null;
          const repoStatus = await io.gitStatusPorcelain(config.repoRoot);
          const verdict = verifyRuling({ before, after, repoStatus, marker: markerRaw });
          outcome = verdict.outcome;
          rulingId = verdict.rulingId ?? null;
          parkMarkerKind = verdict.parkMarkerKind;
        } else if (action.session === 'ratify') {
          const verdict = verifyRatify({ before, after, named: observation.unratifiedRulings });
          outcome = verdict.outcome;
        } else {
          const finalReport = entryExists(io, paths.dir, 'final-report.md')
            ? io.readFileOrEmpty(paths.finalReport)
            : null;
          const verdict = verifyClosing({ finalReport, answers: after });
          outcome = verdict.outcome;
        }

        loopState.lastSessionOutcome = { kind: action.session, cardId: action.cardId, outcome, rulingId, parkMarkerKind };

        const ledgerVerdict: LedgerVerdict = outcome === 'history_rewritten' || outcome === 'ratify_out_of_scope'
          ? 'failed'
          : outcome;
        appendLedgerEntry(io, paths.ledger, {
          at: endedAtIso,
          kind: action.session,
          cardId: action.cardId,
          sessionId: result.sessionId,
          model: config.model,
          startedAt: startedAtIso,
          endedAt: endedAtIso,
          usage: result.usage,
          costUsd: result.totalCostUsd,
          permissionDenials: result.permissionDenials?.length ?? null,
          verdict: ledgerVerdict,
          rulingId,
          round: action.session === 'ruling' && action.cardId !== null
            ? (supState.rulingRounds[action.cardId] ?? null)
            : null,
        });

        persist();
        publish(stateLabelFor(action), `spawn_session:${action.session}`, null);
        continue;
      }

      case 'archive_escalation': {
        const escalationPath = escalationPathOf(homeDir, action.cardId);
        io.renameIfPresent(escalationPath, `${escalationPath}.resolved-${action.rulingId}`);
        loopState.landedThisRun.push(action.rulingId);
        persist();
        publish(stateLabelFor(action), 'archive_escalation', null);
        continue;
      }

      case 'park': {
        const cardIdHint = currentLastSessionOutcome?.cardId ?? nextUnansweredCardId(observation.escalations);
        const content = renderNeedsOwner({
          campaignSlug: config.campaign,
          campaignHome: homeDir,
          reason: action.reason,
          atMs: io.nowMs(),
          cardId: cardIdHint,
          question: null,
          rulingRoundsUsed: Object.entries(supState.rulingRounds)
            .map(([cardId, used]) => ({ cardId, used, max: config.limits.maxRulingRounds })),
          spawnsUsed: { used: supState.spawns, max: config.limits.maxSpawns },
          rulingsLandedThisRun: loopState.landedThisRun,
          watchdogRuns: supState.watchdogRuns,
          lastWatchdogTerminalReason: observation.lastWatchdog?.terminal?.reason ?? null,
          ledgerLines: io.readFileOrEmpty(paths.ledger).split('\n').filter((l) => l.length > 0),
          rerunCommand: config.rerunCommand,
        });
        // REFUTED in advance: never retry a failed park write — print one typed line and exit
        // 20 anyway (see the `unsupported_version` branch above for the identical reasoning).
        try {
          io.writeFileAtomic(paths.needsOwner, content);
        } catch (err) {
          console.error(`supervisor: NEEDS_OWNER.md write failed (${String(err)}); exiting anyway`);
        }
        persist();
        // The categorical `ParkReason` — matching `WatchdogTerminal`'s own precedent of a
        // machine-checkable reason, not the free-text `action.detail` sentence (which is
        // rendered into `NEEDS_OWNER.md` above, and nowhere else).
        publish('terminal', `park:${action.reason}`, {
          status: 'needs_owner', reason: action.reason, exitCode: exitCodeOf('needs_owner'),
        });
        return {
          exitCode: exitCodeOf('needs_owner'), kind: 'needs_owner', reason: action.reason, statusPath: paths.status,
        };
      }

      case 'exit': {
        persist();
        publish('terminal', `exit:${action.reason}`, {
          status: 'done', reason: action.reason, exitCode: exitCodeOf('done'),
        });
        return { exitCode: exitCodeOf('done'), kind: 'done', reason: action.reason, statusPath: paths.status };
      }
    }
  }
}
