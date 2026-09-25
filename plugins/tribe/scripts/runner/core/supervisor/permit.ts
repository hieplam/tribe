/**
 * Least-privilege write containment for a `ruling`/`ratify` one-shot session (card
 * `campaign-supervisor`, spec §5.1/§19.4, Ratified decisions item 4 — quoted verbatim):
 * "A ruling/ratify session may write only under the campaign home." **This hook is the ONLY
 * enforcement there is (S-P12)** — measured (spec §19.4): with the hook removed, the identical
 * envelope wrote to the repo, to `/tmp`, and through a symlink out of the home.
 * `permissionMode: 'default'` confines nothing on its own; `additionalDirectories` is a read
 * convenience, never a write boundary.
 *
 * Oracle (owner decision 4): a `Write`/`Edit` whose resolved target is not inside the campaign
 * home is DENIED. Over-denying is by design; one escaped write is the defect — every branch
 * below fails CLOSED, including malformed input and every tool that is neither `Read` nor
 * `Write`/`Edit`.
 *
 * `containPath` stays pure (`pure-core.md`): a lexical decision over two already-absolute
 * strings, reusing `containHome`'s segment-comparison logic from `core/watchdog/args.ts` rather
 * than duplicating it (fixtures-mirror-reality.md's own lesson: a string PREFIX is not
 * containment — `<home>-sibling` must DENY). Catching a symlink escape needs the filesystem, so
 * that part cannot be pure: `buildContainmentHook(homeDir, io)` is the impure edge, built the
 * same way `core/session.ts`'s `decideMergeGateHook(io)` already is — a builder that closes over
 * an injected capability and returns the actual `PreToolUse` hook function.
 */
import { isAbsolute, normalize, relative, sep } from 'node:path';
import { containHome } from '../watchdog/args.ts';
import { isHomeConfigSurface } from './home-config.ts';
import type { HookDecision } from '../session.ts';

const CONTAINMENT_DENIED_REASON =
  'Writes are confined to the campaign home for this session (least-privilege judgment session, ' +
  'decision 4): the target either falls outside the campaign home or could not be verified. ' +
  'Only Write/Edit under the campaign home are permitted; Read is unrestricted.';

// R13.1: a denial's `permissionDecisionReason` must name the ACTUAL reason (readable-code.md
// symptom 6 — one message standing in for two different facts is exactly the trap). A tool that
// is simply not on the grant at all (spec §5.1's allowedTools row) is a DIFFERENT fact than a
// Write/Edit whose resolved target escaped the campaign home — so it gets its own message, never
// borrowing `CONTAINMENT_DENIED_REASON`.
const NOT_GRANTED_REASON =
  'This judgment session is not granted this tool; only Read, Grep, Glob, Skill and Write/Edit ' +
  'under the campaign home are permitted.';

/** Card supervisor-home-settings-containment (spec §6.2): the campaign home is also the next
 * supervisor session's settings root (its `cwd`, with the `project`/`local` tiers loaded), so a
 * configuration file written here would load as that session's settings or instructions —
 * MEASURED: hooks in either tier run shell commands, and `CLAUDE.md` reaches its context. */
export const HOME_CONFIG_DENIED_REASON =
  'Writing Claude Code configuration inside the campaign home is refused (.claude/, CLAUDE*.md, ' +
  '.mcp.json): the campaign home is the next supervisor session\'s settings root, so this file ' +
  'would load as that session\'s settings or instructions.';

function deny(reason: string = CONTAINMENT_DENIED_REASON): HookDecision {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/** PURE: is the already-absolute `target` a proper descendant of `homeDir`, by path SEGMENT —
 * never by string prefix (`<home>-sibling` shares no segment with `<home>` and must fail)? A
 * non-absolute `target` (or `homeDir`) cannot be judged at all and is denied outright. `target`
 * is normalized first (lexical `..`/`.` collapse only — no filesystem access; that is
 * `buildContainmentHook`'s job below) so a `../` escape is caught before the segment compare
 * runs, exactly like the `${HOME}/../other/answers.md` row in `decideContainmentHook`'s table. */
export function containPath(target: string, homeDir: string): boolean {
  if (!isAbsolute(target) || !isAbsolute(homeDir)) return false;
  return containHome(normalize(target), homeDir).ok;
}

/** PURE: the containment decision table. Fails CLOSED by default — the shapes ever ALLOWED are
 * `Read`/`Grep`/`Glob` (any location: spec §5.1's allowedTools row grants all three to
 * ruling/ratify; they are read-only, so — same as `Read` — no `path`/`file_path` argument of
 * theirs can ever write, hence no containment check applies to them), `Skill` (owner ruling R2 —
 * loading a skill's content writes nothing, so it needs no path check either), and a
 * `Write`/`Edit` whose `tool_input.file_path` passes `containPath` and is not a configuration
 * surface (`home-config.ts#isHomeConfigSurface`). Every other tool — including
 * `Bash`, which is also on `disallowedTools`, denied here too as the ordinary fail-closed default
 * rather than a special-cased carve-out — and every malformed/absent event denies rather than
 * throwing, with `NOT_GRANTED_REASON` (never the write-containment message, which would misstate
 * the reason). This table operates on `file_path` LEXICALLY (no filesystem access): it is what
 * `buildContainmentHook` below calls, once for the fast Read/Grep/Glob/Skill/Bash/malformed cases
 * and once more with a symlink-RESOLVED `file_path` for `Write`/`Edit`. */
export function decideContainmentHook(homeDir: string, input: unknown): HookDecision {
  const event = (input ?? {}) as { tool_name?: unknown; tool_input?: unknown };
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';

  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') return {};

  // Owner ruling R2: loading a skill's content writes nothing, so Skill needs no path check. A
  // tool the loaded skill then asks for still comes through THIS table and is judged on its own.
  const isSkillLoad = toolName === 'Skill';
  if (isSkillLoad) return {};

  if (toolName === 'Write' || toolName === 'Edit') {
    const toolInput = (event.tool_input ?? {}) as { file_path?: unknown };
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    const isInsideHome = filePath !== '' && containPath(filePath, homeDir);
    if (!isInsideHome) return deny();
    // The home is also the next session's settings root (spec §6.2): a configuration surface
    // written here would load as that session's configuration.
    const isConfigSurface = isHomeConfigSurface(relative(homeDir, normalize(filePath)));
    return isConfigSurface ? deny(HOME_CONFIG_DENIED_REASON) : {};
  }

  return deny(NOT_GRANTED_REASON);
}

/** Climbs from `target` up through its ancestors (deepest first) until `realpath` reports a
 * change — the deepest EXISTING ancestor, symlink-resolved — then appends the remaining
 * (necessarily non-existent, e.g. the file being newly created) segments back on, verbatim. A
 * `realpath` that never reports a change all the way to the filesystem root means no symlink sits
 * anywhere in the chain, so `target` unchanged already IS its own real path. Injected `realpath`
 * mirrors the production adapter's contract (see `ports.ts`'s `DirScanPort.realpath`): it
 * returns its input unchanged for a path that does not exist, which is exactly what makes
 * "keep climbing" and "stop, we resolved something real" distinguishable with one function. */
function resolveExistingAncestor(realpath: (path: string) => string, target: string): string {
  const segments = target.split(sep).filter(Boolean);
  let candidate = target;
  for (let cut = segments.length; cut >= 0; cut--) {
    const resolved = realpath(candidate);
    if (resolved !== candidate) {
      const suffix = segments.slice(cut).join(sep);
      return suffix ? `${resolved}${sep}${suffix}` : resolved;
    }
    const parent = cut > 0 ? sep + segments.slice(0, cut - 1).join(sep) : candidate;
    if (parent === candidate) break; // reached the filesystem root; nothing left to climb
    candidate = parent;
  }
  return target;
}

/** IMPURE EDGE (the hook cannot be pure — catching a symlink escape needs the filesystem):
 * resolves a `Write`/`Edit` target's deepest existing ancestor through `io.realpath` BEFORE
 * `decideContainmentHook` runs its (pure) table over the result. `Read`, `Grep`, `Glob`, `Bash`,
 * and every malformed event skip filesystem access entirely and go straight to the pure table —
 * there is nothing to resolve. A non-absolute `file_path`, or a `realpath` call that throws (e.g.
 * a broken symlink), denies with the write-containment reason rather than crashing the hook
 * (`fail-closed-edges.md`) — this branch is reached only for `Write`/`Edit`, so that reason is
 * accurate here. */
export function buildContainmentHook(
  homeDir: string,
  io: { realpath(path: string): string },
): (input: unknown) => Promise<HookDecision> {
  return async (input: unknown): Promise<HookDecision> => {
    const event = (input ?? {}) as { tool_name?: unknown; tool_input?: unknown };
    const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';

    if (toolName !== 'Write' && toolName !== 'Edit') {
      return decideContainmentHook(homeDir, input);
    }

    const toolInput = (event.tool_input ?? {}) as { file_path?: unknown };
    const rawPath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    if (rawPath === '' || !isAbsolute(rawPath)) return deny();

    let resolvedPath: string;
    try {
      resolvedPath = resolveExistingAncestor(io.realpath, rawPath);
    } catch {
      return deny();
    }

    return decideContainmentHook(homeDir, { tool_name: toolName, tool_input: { file_path: resolvedPath } });
  };
}

/** PURE (card supervisor-session-settings, ruling R1): enforces `closing`'s explicit grant. `closing`
 * loads the user/project/local settings tiers, and any of them may carry a `permissions.allow`
 * rule that would auto-approve a tool outside the grant (MEASURED: `Workflow` ran once such a
 * rule was loaded). A PreToolUse deny beats an allow rule, so this hook is what keeps the grant
 * exactly the listed tools on every host. Fails CLOSED: a malformed or unnamed tool denies. The
 * grant arrives as an argument so this module never imports session.ts (which imports it). */
export function decideClosingGrantHook(grantedTools: readonly string[], input: unknown): HookDecision {
  const event = (input ?? {}) as { tool_name?: unknown };
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
  const isGranted = toolName !== '' && grantedTools.includes(toolName);
  if (isGranted) return {};
  return deny(
    `This closing session is not granted this tool; only ${grantedTools.join(', ')} are ` +
      'permitted, and a settings-file allow rule cannot extend that grant.',
  );
}
