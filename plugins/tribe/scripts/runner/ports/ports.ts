// ports/ports.ts — the single home of every IO seam the runner injects. Pure type
// declarations only (no runtime values): every world-touching effect (gh/git, fs, the clock,
// the lock, the Agent SDK spawn) is reached through one of the interfaces below, never a
// direct import of the world-touching module itself (that stays confined to `adapters/`).
//
// Small capability ports compose into the bigger per-module seams (`LoopIO`, `LockIO`) so
// every existing mock/test in core/*.test.ts stays compatible for free —
// TypeScript's structural typing means an object satisfying the composed interface already
// satisfies each capability port, with no test rewritten.

// ---------------------------------------------------------------------------------------
// Capability ports — the smallest independent IO seams.
// ---------------------------------------------------------------------------------------

export interface ExecPort {
  exec(cmd: string[], opts?: { cwd?: string }): Promise<ExecResult>;
}
export interface TimerPort {
  sleep(ms: number): Promise<void>;
}
export interface ClockPort {
  now(): string;
}
export interface FsPort {
  fileExists(resolvedPath: string): boolean;
  readFile(resolvedPath: string): Promise<string> | string;
  writeFile(resolvedPath: string, content: string): void;
  /** P6 (fix-list): renames/moves a file already on disk — used to archive a resolved
   * escalation file (`<path>.resolved-shipped`) rather than delete it, so the ruling trail
   * stays inspectable after the fact. */
  renameFile(from: string, to: string): void;
}
export interface LogPort {
  appendLog(logPath: string, line: string): void;
}
export interface ProcessPort {
  /** OS-level liveness probe (production: `process.kill(pid, 0)`, catching ESRCH). Chosen
   * over a time-based staleness guess: a TTL either wedges a legitimately long-running
   * session (TTL too short) or leaves a truly dead lock stuck for an arbitrary window (TTL
   * too long); a liveness probe is exact in both directions and costs one syscall. */
  isProcessAlive(pid: number): boolean;
  currentPid(): number;
}
export interface LockStorePort {
  readLock(): LockInfo | null;
  writeLock(info: LockInfo): void;
  removeLock(): void;
}
export interface SessionSpawnPort {
  spawnSession(params: SpawnSessionParams): AsyncIterable<SessionMessage>;
}
export interface RunHomePort {
  /** mkdir -p semantics; idempotent. */
  ensureDir(resolvedPath: string): void;
  /** Crash-safe write: temp file in the same directory, then rename (spec §4). */
  writeFileAtomic(resolvedPath: string, content: string): void;
}

/** Task 27 (spec §10.4): the adapter's `/healthz` probe result — a typed report of WHAT the
 * fetch observed, never the reuse/spawn/stale DECISION itself (`pure-core.md`: the adapter
 * executes and reports facts; `core/viewer-launch.ts#decideViewerLaunch` is the only place
 * that inspects `body`'s `viewer`/`v` fields against the v2 floor and decides). A connection
 * failure/timeout is `no-response`; a non-JSON or non-object body is `unparseable`; anything
 * else — including an old v1 body or an unrelated service's 200 — is `responded` with the
 * parsed body, unclassified. */
export type ProbeSignal =
  | { kind: 'no-response' }
  | { kind: 'unparseable' }
  | { kind: 'responded'; body: Record<string, unknown> };

/** Task 13 (spec D11/D12): the runner's live-viewer auto-start seam. Production wires this
 * to a `GET /healthz` fetch and a detached `node:child_process` spawn
 * (`adapters/viewer-launch.adapter.ts`, the only file naming `node:child_process` for this
 * feature); `core/viewer-launch.ts`'s `decideViewerLaunch` only ever sees the `ProbeSignal`
 * this port produces — it never touches the network or a process itself. */
export interface ViewerPort {
  /** Read-only reuse probe against `http://127.0.0.1:<port>/healthz` (card D6). Never
   * throws (fail-closed-edges.md): every fetch/parse failure degrades to a typed `ProbeSignal`
   * member instead. */
  probeViewer(port: number): Promise<ProbeSignal>;
  /** Detached, `stdio: 'ignore'`, `unref()`ed — cannot hold the runner open, cannot pollute
   * its stdout, cannot fail it (D12: "observability exhaust never kills a run"). */
  spawnDetached(argv: string[]): void;
}

// ---------------------------------------------------------------------------------------
// ExecResult — unified. Previously defined TWICE, identically, in core/verify.ts and
// core/github.ts (core/loop.ts re-exported the verify.ts one) — one definition now.
// ---------------------------------------------------------------------------------------

/** One shell/network call, injected. Production wires this to `child_process` + `gh`/`git`;
 * tests drive a fully mocked matrix and never invoke a real binary. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------------------
// verify.ts's seam.
// ---------------------------------------------------------------------------------------

/** io seam for verify.ts. `exec` covers every gh/git call; `fileExists` + `readFile` cover
 * reading the card's plan file for the D3 point-6 front-matter guard — all injected so this
 * module stays pure TypeScript (test-first rule, global constraint). */
export interface VerifyIO {
  exec(cmd: string[], options?: { cwd?: string }): Promise<ExecResult>;
  /** C1 (HARDENING-BACKLOG): verify runs AFTER the merge, and a card may legitimately delete
   * its own planning docs as part of its work — so the plan's presence is checked first and a
   * missing plan is a reportable guard input, never a thrown ENOENT. `resolvedPath` is already
   * joined against `config.repoRoot` by this module. */
  fileExists(resolvedPath: string): boolean;
  /** `resolvedPath` is already joined against `config.repoRoot` by this module — callers
   * never see a bare relative path. */
  readFile(resolvedPath: string): Promise<string> | string;
}

// ---------------------------------------------------------------------------------------
// report.ts's seam.
// ---------------------------------------------------------------------------------------

/** World-touching seam. No direct `fs`/`child_process` import anywhere in `report.ts`. */
export interface ReportIO {
  fileExists(resolvedPath: string): boolean;
  readFile(resolvedPath: string): string | Promise<string>;
  writeFile(resolvedPath: string, content: string): void;
}

// ---------------------------------------------------------------------------------------
// state.ts's seam (moved out of core/types.ts — the kernel imports nothing local, so this
// seam interface, which is pure vocabulary but not part of the shared data shapes, lives
// here instead; state.ts/loop.ts/state.test.ts import it from here).
// ---------------------------------------------------------------------------------------

/** io seam for nextCard's disk checks (D5 PLANNING_NEEDED detection, and the P6 fix-list's
 * escalation-file check below). state.ts never calls `fs` directly — every world-touching
 * check is injected through this. */
export interface StateIO {
  /** The target repo root that `spec`/`plan` paths are resolved against (an input, per
   * spec §2 — never hardcoded). */
  repoRoot: string;
  /** P6 (fix-list): the campaign's machine-local home (`--home`) — needed to resolve an
   * `escalated` card's escalation-file path (`escalationPathOf(homeDir, cardId)`), the same
   * way `deriveCardPhase` already does, so `nextCard` can tell an UNANSWERED escalation
   * (file still present) from an ANSWERED one (file archived/renamed away by the skill's
   * ruling ritual or by `shipCard`) instead of gating solely on `card.status`. */
  homeDir: string;
  /** Returns true if the given (already-resolved) path exists on disk. */
  fileExists(resolvedPath: string): boolean;
}

// ---------------------------------------------------------------------------------------
// session.ts's seam + the pinned §D1 option shapes.
// ---------------------------------------------------------------------------------------

/** Loose supertype of the SDK's `SDKMessage` discriminated union — the runner only ever
 * narrows on `type`/`subtype`/`session_id`/`result`, so it doesn't need (or want) to import
 * the SDK's full internal message union outside session.adapter.ts. */
export interface SessionMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  [key: string]: unknown;
}

export interface SpawnSessionParams {
  prompt: string;
  options: PinnedSessionOptions;
}

/** The seam: production code funnels every session spawn through here so tests never hit
 * the real SDK or the network. Log writing is injected too (`appendLog`). */
export interface SessionIO {
  spawnSession(params: SpawnSessionParams): AsyncIterable<SessionMessage>;
  /** Invoked IMMEDIATELY on receipt of the first `system/init` message's `session_id` —
   * before any further message is processed. This drives the crash-safe state write; the
   * session id is SDK-assigned and cannot be known before spawn (spec §D1/§D4). */
  onSessionStart(sessionId: string): void;
  appendLog(logPath: string, line: string): void;
  /** P2 fix-list card: the pre-merge check gate's one I/O call — runs `gh pr checks` (or
   * any other argv) in the target repo. Optional because it is exercised only by the merge
   * gate hook, not by every caller of `SessionIO`; a caller that never wires it is treated
   * as "cannot verify checks" (fail-closed) by the hook, not as a crash. */
  execInRepo?(argv: string[]): Promise<{ stdout: string; exitCode: number }>;
}

/** The exact §D1 pinned option set, pinned in this one module. Every field is load-bearing
 * — do not "simplify" any away (see the per-field notes on `buildSessionOptions` in
 * `core/session.ts`). */
export interface PinnedSessionOptions {
  cwd: string;
  model: string;
  systemPrompt: { type: 'preset'; preset: 'claude_code' };
  settingSources: ['project'];
  plugins: Array<{ type: 'local'; path: string }>;
  permissionMode: 'bypassPermissions';
  allowDangerouslySkipPermissions: true;
  abortController: AbortController;
  executable: 'bun';
  resume?: string;
  /** PreToolUse deny-hook enforcing the anti-livelock wall (a backgrounded job dies with the
   * one-shot session that started it). Prose in the brief alone failed six workers in the
   * 2026-07-17 incident, so the rule is enforced at the permission layer too. */
  hooks: { PreToolUse: Array<{ hooks: Array<(input: unknown) => Promise<HookDecision>> }> };
}

/** What a PreToolUse hook returns: either nothing (allow) or an explicit deny. */
export interface HookDecision {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
}

// ---------------------------------------------------------------------------------------
// loop.ts's seams — the §D4 phase-derivation io, the §D2 single-instance lock, the pending
// state-commit record, and the full orchestrator seam.
// ---------------------------------------------------------------------------------------

export interface DerivePhaseIO {
  exec(cmd: string[], opts?: { cwd?: string }): Promise<ExecResult>;
  fileExists(resolvedPath: string): boolean;
}

export interface LockInfo {
  pid: number;
  startedAt: string;
}

/** §D2 single-instance lock seam. Composed from the capability algebra above. */
export interface LockIO extends LockStorePort, ProcessPort, ClockPort {}

/** The full seam the orchestrator (`core/loop.ts`) needs. Every field is injected;
 * production wiring (`adapters/run-io.adapter.ts`) supplies the real gh/git/fs/SDK/clock/lock
 * implementations. Composed from the capability algebra above — the member set is exactly
 * today's `LoopIO`, just assembled from smaller named pieces instead of one flat interface. */
export interface LoopIO
  extends ExecPort,
    TimerPort,
    ClockPort,
    FsPort,
    LogPort,
    ProcessPort,
    LockStorePort,
    SessionSpawnPort,
    RunHomePort,
    LinePort {}

// ---------------------------------------------------------------------------------------
// Campaign watchdog seams (card i74). Type declarations only, same as the rest of this file.
// ---------------------------------------------------------------------------------------

/** A spawned runner process the watchdog OWNS. There is deliberately no `kill`: card G4 —
 * "It never kills the runner (the runner's own --session-timeout owns that)". */
export interface RunnerHandle {
  pid: number;
  /** Resolves with the child's exit code, or `null` when `waitMs` elapsed first (the child is
   * still running). Never rejects, never kills. Bounded per call (W-P7). */
  waitFor(waitMs: number): Promise<number | null>;
}

export interface RunnerSpawnPort {
  /** `argv[0]` is the program. stdout+stderr are appended to `stdoutPath`. `env` is optional
   * and production never passes it (the runner inherits the watchdog's own environment
   * exactly as before, which matters: the runner's `ANTHROPIC_API_KEY` guard runs inside the
   * spawned process and must keep seeing the real environment) — only a test substitutes a
   * scripted double here that needs its own env vars threaded through. */
  spawnRunner(
    argv: string[],
    opts: { cwd: string; stdoutPath: string; env?: Record<string, string | undefined> },
  ): RunnerHandle;
  /** The command prefix that runs the real campaign runner, e.g. `['bun', '/abs/run.ts']` —
   * resolved from the adapter's own file location, never from the shell's cwd (the same wall
   * `resolve-runner.sh` holds for the skill). A test substitutes a double here. */
  runnerCommand(): string[];
}

export interface DirScanPort {
  /** Non-recursive listing; a missing or unreadable directory is `[]`, never a throw. */
  listEntries(dirPath: string): Array<{ name: string; mtimeMs: number; isDir: boolean }>;
  /** The last `maxBytes` bytes of a file as UTF-8; `''` for a missing/unreadable file. The
   * first line of the result may be truncated mid-JSON — the parser expects that. */
  readTail(filePath: string, maxBytes: number): string;
  /** Symlink-resolved absolute path; returns its input unchanged when the path does not
   * exist (containment still applies to the un-resolved form). */
  realpath(path: string): string;
}

export interface EnvPort {
  /** The user's `$HOME` — the containment root's parent (W-P10). */
  userHome(): string;
  cwd(): string;
}

/** READ-only lock access: the watchdog observes the runner's single-instance lock and must
 * never write or remove it (spec §2.1 "Never"). Deliberately NOT `LockStorePort`. */
export interface LockReadPort {
  readLock(): LockInfo | null;
}

export interface MsClockPort {
  /** Epoch milliseconds — the clock the pure decision core compares against. */
  nowMs(): number;
}

export interface FileReadPort {
  fileExists(resolvedPath: string): boolean;
  /** `''` for a missing/unreadable file — the caller decides what absence means. */
  readFile(resolvedPath: string): string;
}

export interface AppendFilePort {
  /** Append-only, creating parent directories; the content is written verbatim. */
  appendFile(resolvedPath: string, content: string): void;
}

export interface LinePort {
  /** One human-readable line per action (spec §2.1 "Stdout: one human line per action").
   * Injected so the loop stays a pure-ish orchestrator with no console dependency. */
  printLine(line: string): void;
}

/** The full seam `core/watchdog/watch-loop.ts` needs, composed from the algebra above. */
export interface WatchdogIO
  extends FileReadPort,
    AppendFilePort,
    RunHomePort,
    ProcessPort,
    TimerPort,
    ClockPort,
    MsClockPort,
    RunnerSpawnPort,
    DirScanPort,
    EnvPort,
    LockReadPort,
    LinePort {}

// ---------------------------------------------------------------------------------------
// Transcript reading edge (Task 3, spec §15, card `## Measure first`). Type declarations
// only, same as the rest of this file — the real implementation is
// `adapters/transcript-io.adapter.ts`.
// ---------------------------------------------------------------------------------------

export interface TranscriptIO {
  /** Streams `path` one line at a time — never the whole file in one buffer (measured: the
   * largest single transcript line is 442,691 bytes; a real session is 4.6 MB). */
  readLines(path: string): Iterable<string>;
  /** Reads EXACTLY `min(bytes, currentSize)` bytes from the start of `path` and hashes
   * exactly those bytes — never the whole file (S-P14: this is what makes a pinned cut
   * reproducible). */
  readPrefix(path: string, bytes: number): { text: string; sha256: string; actualBytes: number };
  fileExists(path: string): boolean;
  /** Absolute paths of `root`'s immediate subdirectories. Non-recursive; a missing or
   * unreadable root is `[]`, never a throw. */
  listProjectDirs(root: string): string[];
  /** `$CLAUDE_CONFIG_DIR/projects` when `CLAUDE_CONFIG_DIR` is set and non-empty, else
   * `$HOME/.claude/projects` (viewer README, "## Run it", verbatim). An empty
   * `CLAUDE_CONFIG_DIR=` is treated as unset. */
  projectsRoot(): string;
}
