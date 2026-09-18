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
import { isAbsolute, normalize, sep } from 'node:path';
import { containHome } from '../watchdog/args.ts';
import type { HookDecision } from '../session.ts';

const CONTAINMENT_DENIED_REASON =
  'Writes are confined to the campaign home for this session (least-privilege judgment session, ' +
  'decision 4): the target either falls outside the campaign home or could not be verified. ' +
  'Only Write/Edit under the campaign home are permitted; Read is unrestricted.';

function deny(): HookDecision {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: CONTAINMENT_DENIED_REASON,
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

/** PURE: the containment decision table. Fails CLOSED by default — the only two shapes ever
 * ALLOWED are a `Read` (any location: spec §5.1/§5.2, "Read access to the target repo is
 * granted via `additionalDirectories`") and a `Write`/`Edit` whose `tool_input.file_path` passes
 * `containPath`. Every other tool — including `Bash`, which is also on `disallowedTools`, denied
 * here too as the ordinary fail-closed default rather than a special-cased carve-out — and every
 * malformed/absent event denies rather than throwing. This table operates on `file_path`
 * LEXICALLY (no filesystem access): it is what `buildContainmentHook` below calls, once for the
 * fast Read/Bash/malformed cases and once more with a symlink-RESOLVED `file_path` for
 * `Write`/`Edit`. */
export function decideContainmentHook(homeDir: string, input: unknown): HookDecision {
  const event = (input ?? {}) as { tool_name?: unknown; tool_input?: unknown };
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';

  if (toolName === 'Read') return {};

  if (toolName === 'Write' || toolName === 'Edit') {
    const toolInput = (event.tool_input ?? {}) as { file_path?: unknown };
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    return filePath !== '' && containPath(filePath, homeDir) ? {} : deny();
  }

  return deny();
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
 * `decideContainmentHook` runs its (pure) table over the result. `Read`, `Bash`, and every
 * malformed event skip filesystem access entirely and go straight to the pure table — there is
 * nothing to resolve. A non-absolute `file_path`, or a `realpath` call that throws (e.g. a
 * broken symlink), denies rather than crashing the hook (`fail-closed-edges.md`). */
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
