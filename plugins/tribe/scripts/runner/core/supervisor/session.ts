/**
 * The one-shot session option block and runner (card `campaign-supervisor`, spec §5.1). Mirrors
 * the shape `core/session.ts` already established for the executor — `buildOneShotOptions`
 * mirrors `buildSessionOptions`, `runOneShotSession` mirrors `runSession` — but the envelope
 * itself is NOT `core/session.ts`'s `PinnedSessionOptions`: that type is pinned to
 * `permissionMode: 'bypassPermissions'` for the (trusted-with-the-repo) executor, and decision 4
 * requires `permissionMode: 'default'` here (least privilege for a judgment session). This
 * module therefore declares its OWN envelope type and its own seam (below), consuming the
 * message stream the same way `core/session.ts` does (an injected `spawnSession` returning
 * `AsyncIterable<SessionMessage>`, `onSessionStart`, `appendLog`) — it never imports the SDK.
 *
 * PURE module except `runOneShotSession`'s message-stream consumption, which is the same
 * "PURE-except-for-the-one-injected-call" shape `core/session.ts`'s `consumeSession` already
 * uses — every effect (spawn, log, clock via `setTimeout`) arrives through the injected seam.
 */
import { decideScanGuardHook, type HookDecision, type SessionMessage } from '../session.ts';
import type { SessionKind } from './model.ts';
import type { LedgerEntryUsage } from './model.ts';
import { buildContainmentHook, buildHomeConfigWriteHook, decideClosingGrantHook } from './permit.ts';

/** spec §5.2/§5.3: the tool grant for a `ruling`/`ratify` session. `closing` (§5.4) carries its
 * OWN, wider grant — R11 (Task 20), below `CLOSING_ALLOWED_TOOLS`/`CLOSING_DISALLOWED_TOOLS` —
 * because no loaded settings tier grants `closing` anything by itself (spec §5.4, R11): an
 * un-granted `closing` session cannot run headless at all. `Skill` by owner ruling R2 (card
 * supervisor-session-settings), so `/c3` loads its content here; its CLI still cannot run,
 * because this envelope has no `Bash` (`JUDGMENT_DISALLOWED_TOOLS`) — a known, accepted limit. */
const JUDGMENT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Skill'] as const;

/** spec §5.1: no shell, no subagents, no network, and no wait-tool for a ruling/ratify session —
 * the same wall `core/session.ts`'s executor envelope holds (a one-shot session that arms a
 * Monitor dies before the notification can ever reach it), restated here rather than imported
 * because this envelope is otherwise unrelated to the executor's `PinnedSessionOptions`. */
const JUDGMENT_DISALLOWED_TOOLS = ['Bash', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'Monitor', 'ScheduleWakeup'] as const;

/** R11 (owner ruling, Task 20, spec §5.4): the `closing` session's own explicit tool grant —
 * exactly the tools Stage D uses, nothing more. Before R11, `closing` carried NO
 * allowedTools/disallowedTools at all, relying on a loaded settings tier for a grant; but no
 * settings tier supplies one for this envelope, so the session could not run headless.
 * `allowedTools`/`disallowedTools` here still do not "confine" anything by themselves (§5.1's
 * own hook-is-the-enforcement-layer finding) — they are what makes a `'default'`-permissionMode
 * session headless in the first place (an allowlisted tool never prompts). */
const CLOSING_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash', 'Skill'] as const;

/** R11: no subagents, no network, no wait-tool for `closing` either — `Bash` stays granted
 * (above) because `closing` legitimately runs `verify-shipped` and lands the governance PR
 * (§5.4's named exception); this list only removes the tools nothing in Stage D needs. */
const CLOSING_DISALLOWED_TOOLS = ['Task', 'Agent', 'WebFetch', 'WebSearch', 'Monitor', 'ScheduleWakeup'] as const;

/** The scan wall (issue #163; card D2/D3): the executor's own `decideScanGuardHook`, reused —
 * never a second predicate — as its own PreToolUse entry. A supervisor session is the unattended
 * case the wall exists for: a `find /` there raises an OS folder-consent prompt nobody is present
 * to answer. Only this hook is added; the executor's backgrounding, wait-tool and merge-gate
 * hooks are deliberately NOT ported (card D2). */
const SCAN_GUARD_ENTRY = {
  hooks: [(hookInput: unknown) => Promise.resolve(decideScanGuardHook(hookInput))],
};

/** spec §5.1's envelope, for the three one-shot kinds. Deliberately has NO `resume` field at
 * all — not even optional — because G3 says every one-shot session starts from a rendered brief,
 * never a resumed conversation; there is nothing to omit by mistake because there is nowhere to
 * put it. */
export interface OneShotSessionOptions {
  cwd: string;
  model: string;
  settingSources: string[];
  permissionMode: 'default';
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  additionalDirectories?: string[];
  /** R11 (Task 20, spec §5.4 item 4): the SDK's local-plugin option, set on `closing` only, so
   * `verify-shipped` resolves BY NAME inside the session from the repo itself. Kept after the
   * user tier loaded (card supervisor-session-settings, G4, MEASURED): the user tier finds
   * `verify-shipped` only where install.sh symlinked it into ~/.claude/skills — a host fact — while
   * this load works on every host, and where both exist the session registers it once.
   * `ruling`/`ratify` never carry this field. */
  plugins?: Array<{ type: 'local'; path: string }>;
  abortController: AbortController;
  hooks?: { PreToolUse: Array<{ hooks: Array<(input: unknown) => Promise<HookDecision>> }> };
  /** Fix 2 (skinner audit): spec §5.1's bounded-TURN guard, distinct from the wall-clock
   * `sessionTimeoutMs` — "exceeding it is a failed attempt, not a hang." Forwarded verbatim
   * into the SDK's own `query()` options (`adapters/session.adapter.ts`'s pass-through). */
  maxTurns: number;
}

/** `buildOneShotOptions`'s input. `repoRoot` is read access for `ruling` (spec §5.2's
 * `additionalDirectories`) and repo access for `closing` (§5.4's named exception); `ratify` never
 * reads it (§5.3: "No repo access at all"). `realpath` is the containment hook's one injected
 * capability (`permit.ts`'s `buildContainmentHook`) — never `fs` directly (`pure-core.md`).
 * Also used by `closing`'s configuration-write hook (`permit.ts#buildHomeConfigWriteHook`). */
export interface OneShotSessionConfig {
  /** The campaign home (S-P9) — `cwd` for every one-shot session, and the containment root for
   * `ruling`/`ratify` (spec §14: this is what makes the transcript attributable in the viewer
   * with no viewer change at all). */
  homeDir: string;
  model: string;
  /** Fix 2 (skinner audit): the caller's configured `--session-max-turns` — always supplied
   * (never defaulted here; `args.ts` owns the default), for every one of the three kinds. */
  maxTurns: number;
  repoRoot?: string;
  realpath: (path: string) => string;
  /** R11 (Task 20, spec §5.4 item 4): the `verify-shipped` plugin directory, resolved and
   * existence-checked by the composition root from ITS OWN location (never cwd, never
   * `~/.claude`, never a literal). Read only for `kind === 'closing'`; `undefined` for
   * `ruling`/`ratify`, which never load plugins. The edge (`decide.ts`/`loop.ts`) fails closed
   * before a `closing` session is ever spawned without it — this field, when present, is
   * therefore always a real, existing directory. */
  verifyShippedPluginDir?: string;
}

/** Builds spec §5.1's option block. `permissionMode` is `'default'` for every kind — never
 * `'bypassPermissions'` — because decision 4 draws the trust line at the executor, not at a
 * judgment session (REFUTED in advance, card `## Ratified decisions` item 4: "the executor is
 * trusted with the repo by design; a judgment session is not"). */
export function buildOneShotOptions(
  kind: SessionKind,
  config: OneShotSessionConfig,
  abortController: AbortController,
): OneShotSessionOptions {
  const options: OneShotSessionOptions = {
    cwd: config.homeDir,
    model: config.model,
    // Parity with the executor path (card supervisor-session-settings, G3; core/session.ts has
    // the same list): 'user' carries ~/.claude/settings.json's enabledPlugins, so the C3 plugin
    // registers and `Skill c3` no longer returns "Unknown skill: c3". Written explicitly, never by
    // omitting the option, so the regression test keeps a value to assert. MEASURED (spec §4.1):
    // the SDK's own `model` and `permissionMode: 'default'` still win over the user tier's. For a
    // supervisor session `cwd` is the campaign home, so 'project'/'local' read
    // <home>/.claude/settings(.local).json, which no campaign home carries.
    settingSources: ['user', 'project', 'local'],
    permissionMode: 'default',
    abortController,
    maxTurns: config.maxTurns,
  };

  if (kind === 'closing') {
    // R11 (Task 20): §5.4's named exception, now an EXPLICIT tool grant rather than "no
    // list at all" — the settings tiers above grant nothing to this envelope, so without this
    // grant the session could not run headless. Still NO containment hook — this session
    // legitimately lands the governance PR, and `Bash`/repo write are named IN the grant, not
    // left ungoverned.
    options.allowedTools = CLOSING_ALLOWED_TOOLS;
    options.disallowedTools = CLOSING_DISALLOWED_TOOLS;
    if (config.repoRoot !== undefined) options.additionalDirectories = [config.repoRoot];
    // R11 item 4, kept by card supervisor-session-settings (G4): load `verify-shipped` from the
    // repo so it resolves on a host that never ran install.sh. Absent only when the edge
    // (`decide.ts`) has already fail-closed the spawn itself; see its
    // `verifyShippedPluginAvailable` guard.
    if (config.verifyShippedPluginDir !== undefined) {
      options.plugins = [{ type: 'local', path: config.verifyShippedPluginDir }];
    }
    // Still NO containment hook — `closing` legitimately writes the repo (§5.4); this hook refuses
    // only configuration surfaces inside the home. The scan wall is not containment either: it
    // refuses only a filesystem- or home-rooted `find`.
    options.hooks = {
      PreToolUse: [
        // The grant, enforced (card supervisor-session-settings, ruling R1): a host allow rule in a
        // loaded settings tier can never add a tool to CLOSING_ALLOWED_TOOLS.
        { hooks: [(hookInput: unknown) => Promise.resolve(decideClosingGrantHook(CLOSING_ALLOWED_TOOLS, hookInput))] },
        // Card supervisor-home-settings-containment (spec §6.2): the home is the next session's
        // settings root; closing still writes the repo freely, only home configuration is refused.
        { hooks: [buildHomeConfigWriteHook(config.homeDir, { realpath: config.realpath })] },
        SCAN_GUARD_ENTRY,
      ],
    };
    return options;
  }

  options.allowedTools = JUDGMENT_ALLOWED_TOOLS;
  options.disallowedTools = JUDGMENT_DISALLOWED_TOOLS;
  if (kind === 'ruling' && config.repoRoot !== undefined) {
    // Read access to the card's spec/plan only — NOT a write boundary (§5.1: "additionalDirectories
    // is a read convenience"); the hook below is what actually denies a repo write. `ratify` gets
    // no repo access at all (§5.3).
    options.additionalDirectories = [config.repoRoot];
  }
  // "The ONLY enforcement there is" (S-P12) — permit.ts's buildContainmentHook, the impure edge —
  // stays first; the scan wall runs alongside it as defence in depth (card D2), since this
  // envelope already denies Bash.
  options.hooks = {
    PreToolUse: [
      { hooks: [buildContainmentHook(config.homeDir, { realpath: config.realpath })] },
      SCAN_GUARD_ENTRY,
    ],
  };
  return options;
}

export interface OneShotSpawnParams {
  prompt: string;
  options: OneShotSessionOptions;
}

/** The seam `runOneShotSession` consumes — shaped identically to `core/session.ts`'s `SessionIO`
 * (same three members, same `AsyncIterable<SessionMessage>` stream) so tests never hit the real
 * SDK, but declared locally rather than importing `SessionIO`: that type's `spawnSession` is
 * pinned to `PinnedSessionOptions`, which is a different (and incompatible — `permissionMode`
 * alone conflicts) envelope than `OneShotSessionOptions` above. (Not named `...IO`/`...Port`:
 * `structure.test.ts`'s "every IO seam interface's single home is `ports/`" reserves that
 * suffix for `ports/ports.ts`; this seam is intentionally local to this module's own, narrower
 * envelope.) */
export interface OneShotSessionSeam {
  spawnSession(params: OneShotSpawnParams): AsyncIterable<SessionMessage>;
  onSessionStart(sessionId: string): void;
  appendLog(logPath: string, line: string): void;
}

export type OneShotSessionOutcome = 'success' | 'error' | 'timeout';

/** The typed result `runOneShotSession` resolves to — never throws, never rejects. Carries the
 * SDK's own `usage`/`total_cost_usd`/`permission_denials` off the terminal `result` message
 * verbatim, so the G5 ledger needs no transcript parsing and an attempted escape is recorded as
 * evidence rather than merely blocked (spec §5.1). */
export interface OneShotSessionResult {
  outcome: OneShotSessionOutcome;
  sessionId: string | null;
  finalText: string;
  usage: LedgerEntryUsage | null;
  totalCostUsd: number | null;
  permissionDenials: unknown[] | null;
}

export interface RunOneShotInput {
  kind: SessionKind;
  /** The rendered brief (spec §5.2/§5.3/§5.4) — the session's initial prompt. */
  prompt: string;
  config: OneShotSessionConfig;
  /** Wall-clock abort, ms (`fail-closed-edges.md` obligation 3). Never defaulted here — always
   * caller-supplied, same contract as `core/session.ts`'s `RunSessionConfig.sessionTimeoutMs`. */
  sessionTimeoutMs?: number;
}

function errorResult(err: unknown): OneShotSessionResult {
  const message = err instanceof Error ? err.message : String(err);
  return { outcome: 'error', sessionId: null, finalText: message, usage: null, totalCostUsd: null, permissionDenials: null };
}

function parseOneShotResult(message: SessionMessage, sessionId: string): OneShotSessionResult {
  const finalText = typeof message.result === 'string' ? message.result : '';
  const usage = (message.usage ?? null) as LedgerEntryUsage | null;
  const totalCostUsd = typeof message.total_cost_usd === 'number' ? message.total_cost_usd : null;
  const permissionDenials = Array.isArray(message.permission_denials) ? message.permission_denials : null;

  if (message.subtype !== 'success') {
    return {
      outcome: 'error',
      sessionId,
      finalText: finalText || `session ended with error subtype "${message.subtype}"`,
      usage,
      totalCostUsd,
      permissionDenials,
    };
  }
  return { outcome: 'success', sessionId, finalText, usage, totalCostUsd, permissionDenials };
}

async function consumeOneShot(
  input: RunOneShotInput,
  io: OneShotSessionSeam,
  options: OneShotSessionOptions,
): Promise<OneShotSessionResult> {
  let sessionMessages: AsyncIterable<SessionMessage>;
  try {
    sessionMessages = io.spawnSession({ prompt: input.prompt, options });
  } catch (err) {
    return errorResult(err);
  }

  let logPath: string | null = null;
  let sessionId: string | null = null;

  try {
    for await (const message of sessionMessages) {
      if (sessionId === null && message.type === 'system' && message.subtype === 'init') {
        sessionId = String(message.session_id ?? '');
        // Invoked IMMEDIATELY on init receipt, before this (or any later) message is otherwise
        // processed — mirrors `core/session.ts`'s crash-safety ordering exactly.
        io.onSessionStart(sessionId);
        logPath = `${input.config.homeDir}/supervisor/sessions/${sessionId}.log`;
      }

      if (logPath !== null) {
        io.appendLog(logPath, JSON.stringify(message));
      }

      if (message.type === 'result') {
        return parseOneShotResult(message, sessionId ?? '');
      }
    }
    return errorResult(new Error('session ended without a result message'));
  } catch (err) {
    return errorResult(err);
  }
}

/** Runs one judgment/closing session end-to-end: builds spec §5.1's options, streams messages to
 * `<homeDir>/supervisor/sessions/<sessionId>.log`, and resolves to a typed `OneShotSessionResult`
 * — never throws, never rejects (a spawn failure, a mid-stream failure, and a timeout all resolve
 * to a typed outcome instead), mirroring `core/session.ts`'s `runSession` contract exactly. */
export async function runOneShotSession(input: RunOneShotInput, io: OneShotSessionSeam): Promise<OneShotSessionResult> {
  const abortController = new AbortController();
  const options = buildOneShotOptions(input.kind, input.config, abortController);
  const sessionPromise = consumeOneShot(input, io, options);

  if (input.sessionTimeoutMs === undefined) {
    return sessionPromise;
  }

  let timer: ReturnType<typeof setTimeout>;
  const timeoutMs = input.sessionTimeoutMs;
  const timeoutPromise = new Promise<OneShotSessionResult>((resolve) => {
    timer = setTimeout(() => {
      abortController.abort();
      resolve({
        outcome: 'timeout',
        sessionId: null,
        finalText: `session exceeded the ${timeoutMs}ms wall-clock timeout`,
        usage: null,
        totalCostUsd: null,
        permissionDenials: null,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([sessionPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
