// Pinned Claude Agent SDK query() options + session spawn/parse (Task 5b, spec §D1).
//
// PURE module: the SDK itself is imported only by `session.adapter.ts` (the zero-LLM wall).
// This file owns the pinned option block and the message-parsing logic; every module reaches
// a session through the `SessionIO` seam below, never the SDK package directly.
import { join } from 'node:path';
import type { HookDecision, PinnedSessionOptions, SessionIO, SessionMessage, SpawnSessionParams } from '../ports/ports.ts';
import { isFilesystemWideScan } from './metrics/session-hygiene.ts';
import { buildMergeGateDecision, parseMergeCommand } from './merge-gate.ts';

export type { HookDecision, PinnedSessionOptions, SessionIO, SessionMessage, SpawnSessionParams };

/** The tribe plugin's own directory (`plugins/tribe`), derived from this module's location
 * — NEVER a hardcoded absolute path (stateless-capability wall). This is what the SDK's
 * `plugins` option loads the tribe agents from, so a stale user-global `~/.claude/agents`
 * copy cannot shadow them inside an executor session (spec §D1, "Agent duplication" risk).
 * This module lives at `plugins/tribe/scripts/runner/core/session.ts` (ref-plugin-layout: the
 * runner is repo-invoked, not installed, so it sits under `scripts/`) — three directories up
 * from here is `plugins/tribe`. */
export const TRIBE_PLUGIN_DIR = join(import.meta.dir, '..', '..', '..');

/** Terminal outcome of one executor session, derived only from the typed `result` message —
 * never by scraping stdout (spec §D3: done is script-verified, agent SHIPPED is a signal). */
export type SessionOutcome = 'shipped' | 'needs_direction' | 'error' | 'timeout';

export interface SessionResult {
  outcome: SessionOutcome;
  finalText: string;
  pr?: number;
  sha?: string;
}

export interface RunSessionInput {
  /** The rendered executor brief (see `brief.ts`) — the session's initial prompt. */
  brief: string;
  /** SDK session id to resume (spec §D4). A failed resume attempt surfaces as a typed
   * `error` result, never a thrown exception, so callers can fall back to a fresh session. */
  resume?: string;
}

export interface RunSessionConfig {
  /** `--repo` input: session `cwd`. */
  repoRoot: string;
  /** `--model` input: executor model tier. Never defaulted here — always caller-supplied. */
  model: string;
  /** `--session-timeout` input, in ms: wall-clock abort for this session. */
  sessionTimeoutMs?: number;
  /** `--logs-dir` input: session log files land at `<logsDir>/<card>-<sessionId>.log`. */
  logsDir: string;
  /** The card id this session is executing, for log file naming. */
  card: string;
}

/** The reason text a denied backgrounding attempt reports back to the executor. Phrased as
 * an instruction, not just a refusal, so the session's next move is obvious. */
export const BACKGROUNDING_DENIED_REASON =
  'Backgrounding is disabled for campaign executor sessions: this session ends the moment it ' +
  'stops calling tools, and a backgrounded job dies with it. Re-run this call in the ' +
  'foreground with timeout: 600000 (Bash) or run_in_background: false (Agent/Task). If the ' +
  'work cannot fit in 600s, split it by exact file name and run each part in the foreground.';

/** The reason text a denied wait-tool attempt (Monitor / ScheduleWakeup) reports back to the
 * executor. Phrased as an instruction, not just a refusal (spec P1: ×4 incident — a session
 * that arms a wait-tool then ends its turn dies before the notification can ever reach it). */
export const WAIT_TOOL_DENIED_REASON =
  'Wait-tools are disabled for campaign executor sessions: this session ends the moment ' +
  'it stops calling tools, so an armed Monitor/ScheduleWakeup notification can never ' +
  'reach you — ending your turn to wait kills the session. To wait on CI, run ' +
  '`gh pr checks <pr> --watch` in the FOREGROUND (Bash, timeout: 600000) and proceed ' +
  'when it concludes.';

/** PURE: decides whether one PreToolUse event is an attempt to background work.
 *
 * This is the enforcement half of the anti-livelock wall. The 2026-07-17 campaign incident
 * killed 6 of 14 workers exactly this way — a worker backgrounded the ~5m30s e2e suite, said
 * "I'll wait for it to finish", and that sentence WAS its final message, so the session died
 * on the spot and took the job with it. The brief already forbids this in prose; prose failed
 * six times, so the same rule is enforced here where the model cannot talk its way past it.
 *
 * Bash is denied on `run_in_background: true`; Agent/Task is denied unless it explicitly
 * opts out with `run_in_background: false`, because those tools background BY DEFAULT — an
 * omitted field is the dangerous case, not the safe one. */
export function decideBackgroundingHook(input: unknown): HookDecision {
  const event = (input ?? {}) as { tool_name?: unknown; tool_input?: unknown };
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
  const toolInput = (event.tool_input ?? {}) as { run_in_background?: unknown };
  const requested = toolInput.run_in_background;

  const backgrounds =
    toolName === 'Bash' ? requested === true : (toolName === 'Agent' || toolName === 'Task') && requested !== false;

  if (!backgrounds) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: BACKGROUNDING_DENIED_REASON,
    },
  };
}

/** PURE: decides whether one PreToolUse event is an attempt to arm a wait-tool (`Monitor` /
 * `ScheduleWakeup`). Split out of `decideBackgroundingHook` (P1 audit fix-round, should-fix,
 * scout) into its own named hook: waiting synchronously and ending the turn is a DIFFERENT
 * failure mode than backgrounding a job (the P1 spec's own distinction — "ending a turn is not
 * a tool call"), and this repo already has an established one-function-per-PreToolUse-concern
 * shape (`decideMergeGateHook`, below) rather than grafting a second concern onto
 * `decideBackgroundingHook`'s body. Registered as its own separate `PreToolUse` entry in
 * `buildSessionOptions`. */
export function decideWaitToolHook(input: unknown): HookDecision {
  const event = (input ?? {}) as { tool_name?: unknown };
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';

  if (toolName !== 'Monitor' && toolName !== 'ScheduleWakeup') return {};

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: WAIT_TOOL_DENIED_REASON,
    },
  };
}

/** PURE-except-for-the-one-injected-call: decides whether one PreToolUse event is a
 * `gh pr merge` attempt and, if so, whether it may proceed. Every decision (forbidden flag,
 * fail-closed on a `gh pr checks` error, red/pending check) is made by the pure
 * `buildMergeGateDecision` in `merge-gate.ts`; this wrapper's only job is running the exec
 * call that function needs, via the injected `io.execInRepo` seam (spec §Incident: PR #188
 * merged with `format-check` red, master red ~42min — the runner's own post-merge
 * `checksGreen` verify could only detect that breach, not prevent it).
 *
 * Bash-only, and only when `parseMergeCommand` says the command is a merge attempt — every
 * other tool call, and every non-merge Bash command, gets an empty decision (no opinion). */
export function decideMergeGateHook(io: Pick<SessionIO, 'execInRepo'>) {
  return async (hookInput: unknown): Promise<HookDecision> => {
    const event = (hookInput ?? {}) as { tool_name?: unknown; tool_input?: unknown };
    const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
    if (toolName !== 'Bash') return {};

    const toolInput = (event.tool_input ?? {}) as { command?: unknown };
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    const parsed = parseMergeCommand(command);
    if (!parsed.isMerge) return {};

    // A forbidden flag denies outright — never worth spending an exec call to check.
    if (parsed.forbiddenFlag) {
      return buildMergeGateDecision({ parsed });
    }

    if (!io.execInRepo) {
      // No exec seam wired -> cannot verify checks -> fail-closed, same as a `gh pr checks`
      // error (buildMergeGateDecision treats a missing checksExec identically).
      return buildMergeGateDecision({ parsed });
    }

    const argv = ['gh', 'pr', 'checks', ...(parsed.prRef ? [parsed.prRef] : []), '--json', 'name,state'];
    try {
      const checksExec = await io.execInRepo(argv);
      return buildMergeGateDecision({ parsed, checksExec });
    } catch {
      // A rejecting execInRepo (e.g. `gh` missing, ENOENT) must still resolve to the
      // module's own fail-closed deny decision, never propagate as a rejected promise —
      // this hook is documented "fail-closed, never crash". Same treatment as a missing
      // checksExec (buildMergeGateDecision denies identically either way).
      return buildMergeGateDecision({ parsed });
    }
  };
}

/** The reason a denied filesystem-wide scan reports back. Phrased as an INSTRUCTION, not just a
 * refusal (same contract as BACKGROUNDING_DENIED_REASON) — a session that is only blocked will
 * try the next variant of the same hunt; a session that is redirected stops hunting. */
export const SCAN_DENIED_REASON =
  'Filesystem-wide scans are disabled for campaign sessions: scanning from / or $HOME walks ' +
  'Desktop/Documents/Downloads and triggers an OS folder-consent prompt that nobody is present ' +
  'to answer. You almost never need one. For architecture, components or file->component ' +
  'lookup, invoke the `c3` skill (Skill tool, skill name "c3") — it resolves its own tooling. ' +
  'For anything else, scan a specific directory you already know (e.g. the repo root or a ' +
  'package directory), not / or $HOME.';

/** PURE: denies one PreToolUse event that would run a `find` rooted at the filesystem or home
 * root (owner ruling R-a). The predicate itself lives in `core/metrics/session-hygiene.ts` and is
 * shared with the ratchet counter, so the guard and the measurement can never disagree about what
 * a scan is. Bash-only; every other tool gets no opinion. */
export function decideScanGuardHook(input: unknown): HookDecision {
  const event = (input ?? {}) as { tool_name?: unknown; tool_input?: unknown };
  if (event.tool_name !== 'Bash') return {};
  const command = ((event.tool_input ?? {}) as { command?: unknown }).command;
  if (typeof command !== 'string' || !isFilesystemWideScan(command)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: SCAN_DENIED_REASON,
    },
  };
}

/** Builds the §D1 option block verbatim. */
export function buildSessionOptions(
  input: RunSessionInput,
  config: RunSessionConfig,
  abortController: AbortController,
  io: Pick<SessionIO, 'execInRepo'>,
): PinnedSessionOptions {
  const options: PinnedSessionOptions = {
    cwd: config.repoRoot, // --repo input
    model: config.model, // --model input
    systemPrompt: { type: 'preset', preset: 'claude_code' }, // REQUIRED for CLAUDE.md to apply
    // Parity with a person's session (owner ruling 2026-09-20): the CLI's own default tier list.
    // 'user' is what carries ~/.claude/settings.json's enabledPlugins, so the C3 plugin is
    // registered and `Skill c3` resolves; with 'project' alone it returned "Unknown skill: c3".
    // Written explicitly rather than by omitting the option, so the pinned-option regression test
    // below keeps a value to assert and an SDK default change cannot move it silently.
    // PROVEN by real sessions (spec §4.2): the SDK's own `model` and `permissionMode` above still
    // WIN over this tier's `model` / `permissions.defaultMode`.
    settingSources: ['user', 'project', 'local'],
    plugins: [{ type: 'local', path: TRIBE_PLUGIN_DIR }], // tribe agents, never ~/.claude/agents
    permissionMode: 'bypassPermissions', // owner-ruled: headless, never hangs
    allowDangerouslySkipPermissions: true, // required by the SDK for the above
    abortController,
    executable: 'bun',
    hooks: {
      PreToolUse: [
        // Anti-livelock wall, enforced (not merely stated in the brief) — decideBackgroundingHook.
        { hooks: [(hookInput: unknown) => Promise.resolve(decideBackgroundingHook(hookInput))] },
        // Wait-tool wall (P1 fix-list; split into its own hook, P1 audit fix-round) — decideWaitToolHook.
        { hooks: [(hookInput: unknown) => Promise.resolve(decideWaitToolHook(hookInput))] },
        // Pre-merge check gate (P2 fix-list card) — decideMergeGateHook.
        { hooks: [decideMergeGateHook(io)] },
        // Filesystem-wide scan wall (owner ruling R-a) — decideScanGuardHook.
        { hooks: [(hookInput: unknown) => Promise.resolve(decideScanGuardHook(hookInput))] },
      ],
    },
  };
  if (input.resume) {
    options.resume = input.resume;
  }
  return options;
}

const SHIPPED_RE = /SHIPPED\s+#?(\d+)\s+([0-9a-f]{7,40})/i;
const NEEDS_DIRECTION_RE = /NEEDS_DIRECTION:/;

/** Parses the typed `result` message into a `SessionResult` — the only place stdout-style
 * scraping happens, and even here it operates on the SDK's own structured `result` field,
 * never raw process stdout (spec §D3). */
function parseResultMessage(message: SessionMessage): SessionResult {
  const finalText = typeof message.result === 'string' ? message.result : '';

  if (message.subtype !== 'success') {
    return {
      outcome: 'error',
      finalText: finalText || `session ended with error subtype "${message.subtype}"`,
    };
  }

  const shipped = finalText.match(SHIPPED_RE);
  if (shipped) {
    return { outcome: 'shipped', finalText, pr: Number(shipped[1]), sha: shipped[2] };
  }
  if (NEEDS_DIRECTION_RE.test(finalText)) {
    return { outcome: 'needs_direction', finalText };
  }
  return {
    outcome: 'error',
    finalText: finalText || 'result message carried neither a SHIPPED nor a NEEDS_DIRECTION terminal line',
  };
}

function errorResult(err: unknown): SessionResult {
  const message = err instanceof Error ? err.message : String(err);
  return { outcome: 'error', finalText: message };
}

async function consumeSession(
  input: RunSessionInput,
  config: RunSessionConfig,
  io: SessionIO,
  options: PinnedSessionOptions,
): Promise<SessionResult> {
  let sessionMessages: AsyncIterable<SessionMessage>;
  try {
    sessionMessages = io.spawnSession({ prompt: input.brief, options });
  } catch (err) {
    // A failed resume attempt (no transcript, SDK error) must surface as a typed error, not
    // a crash — §D4's resume matrix falls back to a fresh session on this result.
    return errorResult(err);
  }

  let logPath: string | null = null;

  try {
    for await (const message of sessionMessages) {
      if (logPath === null && message.type === 'system' && message.subtype === 'init') {
        const sessionId = String(message.session_id ?? '');
        // Invoked IMMEDIATELY on init receipt, before this (or any later) message is
        // otherwise processed — the crash window this closes is milliseconds wide.
        io.onSessionStart(sessionId);
        logPath = `${config.logsDir}/${config.card}-${sessionId}.log`;
      }

      if (logPath !== null) {
        io.appendLog(logPath, JSON.stringify(message));
      }

      if (message.type === 'result') {
        return parseResultMessage(message);
      }
    }
    return { outcome: 'error', finalText: 'session ended without a result message' };
  } catch (err) {
    return errorResult(err);
  }
}

/** Runs one executor session end-to-end: pins the §D1 options, streams messages to the
 * per-session log file, and resolves to a `SessionResult` parsed from the typed `result`
 * message. Never throws — every failure path (spawn failure, mid-stream failure, timeout)
 * resolves to a typed `SessionResult` instead. */
export async function runSession(
  input: RunSessionInput,
  config: RunSessionConfig,
  io: SessionIO,
): Promise<SessionResult> {
  const abortController = new AbortController();
  const options = buildSessionOptions(input, config, abortController, io);
  const sessionPromise = consumeSession(input, config, io, options);

  if (config.sessionTimeoutMs === undefined) {
    return sessionPromise;
  }

  let timer: ReturnType<typeof setTimeout>;
  const timeoutMs = config.sessionTimeoutMs;
  const timeoutPromise = new Promise<SessionResult>((resolve) => {
    timer = setTimeout(() => {
      abortController.abort();
      resolve({ outcome: 'timeout', finalText: `session exceeded the ${timeoutMs}ms wall-clock timeout` });
    }, timeoutMs);
  });

  try {
    return await Promise.race([sessionPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
