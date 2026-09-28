// P2 fix-list card: the pre-merge check gate — a second PreToolUse hook, alongside the
// anti-livelock hook in session.ts, that stops an executor session from landing `gh pr
// merge` while a PR check is red or still pending. Incident: PR #188 merged with
// `format-check` red -> master red for ~42 minutes (spec §Incident).
//
// PURE module: no imports beyond types (`HookDecision`, from ports.ts). The one I/O call
// this gate needs — actually running `gh pr checks` — is an edge concern; it lives in
// session.ts's hook wrapper, which calls `io.execInRepo(...)` and hands the *result* to
// `buildMergeGateDecision` here. This file never touches a process, a network, or a clock.
import type { HookDecision } from '../ports/ports.ts';

export interface ParsedMergeCommand {
  isMerge: boolean;
  /** The PR ref given to `gh pr merge` (a bare number, a PR URL, or a branch name) — the
   * first token after `merge` that doesn't start with `-`. `undefined` when the command
   * gives no ref (gh then resolves the PR from the current branch). */
  prRef?: string;
  /** Set when `--auto` or `--admin` appears as a standalone token — both are forbidden
   * outright, never routed through the checks gate at all. */
  forbiddenFlag?: string;
}

export interface JudgeChecksResult {
  allGreen: boolean;
  /** Human-readable `"<name>: <state>"` entries for every check that is not `SUCCESS`, or a
   * single explanatory entry when the input couldn't even be judged (parse failure / empty
   * list) — always non-empty when `allGreen` is false. */
  notGreen: string[];
}

export interface MergeGateDecisionInput {
  parsed: ParsedMergeCommand;
  /** The result of `io.execInRepo(['gh', 'pr', 'checks', ...])`, already run by the edge.
   * `undefined` means the edge never attempted the call (or couldn't) — fail-closed, same
   * as a non-zero exit code. */
  checksExec?: { stdout: string; exitCode: number };
  /** Spec §4.6: the PR's current head commit (`gh pr view --json headRefOid`); `null` = unreadable.
   * Optional so a forbidden-flag deny needs neither this nor `doneSha`; absent after green checks
   * denies (fail closed). */
  headSha?: string | null;
  /** The commit at which the runner last passed every task's Done commands; `null` = no Done run
   * has passed yet, so nothing may merge. */
  doneSha?: string | null;
}

const FORBIDDEN_FLAG_NAMES = ['--auto', '--admin'] as const;

/** Matches a token against `--auto`/`--admin`, in both the bare (`--auto`) and cobra
 * `--flag=value` (`--auto=true`) forms — `gh` is a cobra CLI and accepts both; live `gh pr
 * merge --admin=true` reaches the GraphQL call rather than erroring on an unrecognized flag,
 * so a substring/exact-token check alone lets it slip past. `--auto=false`/`--admin=false`
 * explicitly DISABLE the flag, so they are correctly not forbidden. Returns the base flag
 * name (`--auto`/`--admin`), never the full `--flag=value` token, so the deny reason and
 * callers stay flag-name-only regardless of which form was used. */
function matchForbiddenFlag(token: string): string | undefined {
  for (const flag of FORBIDDEN_FLAG_NAMES) {
    if (token === flag) return flag;
    const prefix = `${flag}=`;
    if (token.startsWith(prefix) && token.slice(prefix.length) !== 'false') {
      return flag;
    }
  }
  return undefined;
}

/** Quote-aware, subcommand-anchored tokenizer: splits `command` into one token array per
 * shell subcommand, where subcommands are separated by unquoted `&&`, `||`, `;`, `|`, or a
 * newline, and a single/double-quoted span inside a subcommand becomes ONE token (quotes
 * stripped) instead of being split on internal whitespace. This is NOT a full shell parser
 * (no `$VAR` expansion, no backslash escapes, no backticks) — it exists only to anchor "is
 * this actually invoking `gh pr merge`" at a real command boundary, never a substring match
 * over free text (a commit message that merely MENTIONS "gh pr merge" must not match). */
function tokenizeShellCommand(command: string): string[][] {
  const subcommands: string[][] = [];
  let currentTokens: string[] = [];
  let currentToken = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;

  const flushToken = () => {
    if (hasToken) {
      currentTokens.push(currentToken);
      currentToken = '';
      hasToken = false;
    }
  };
  const flushSubcommand = () => {
    flushToken();
    if (currentTokens.length > 0) subcommands.push(currentTokens);
    currentTokens = [];
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        currentToken += ch;
        hasToken = true;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true; // an empty quoted string ("") still counts as a (empty) token
      i++;
      continue;
    }
    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      flushSubcommand();
      i += 2;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      flushSubcommand();
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      flushToken();
      i++;
      continue;
    }
    currentToken += ch;
    hasToken = true;
    i++;
  }
  flushSubcommand();
  return subcommands;
}

/** Scans one subcommand's own token list for a contiguous `gh`, `pr`, `merge` sequence
 * ANYWHERE within it (not just at index 0) — so a prefix ahead of the invocation (a
 * directory change, an env-var assignment, `sudo`, `exec`, `time`, ...) still matches, same
 * as the spec's literal "Bash command CONTAINING `gh pr merge`" wording. Returns `null` when
 * this subcommand's tokens contain no such sequence (e.g. the phrase only appears inside a
 * single quoted token, which can never equal three separate consecutive tokens). */
function extractMergeInvocation(tokens: string[]): { prRef?: string; forbiddenFlag?: string } | null {
  const mergeIndex = tokens.findIndex((token, i) => token === 'gh' && tokens[i + 1] === 'pr' && tokens[i + 2] === 'merge');
  if (mergeIndex === -1) return null;

  let forbiddenFlag: string | undefined;
  let prRef: string | undefined;

  for (let i = mergeIndex + 3; i < tokens.length; i++) {
    const token = tokens[i];
    const forbidden = matchForbiddenFlag(token);
    if (forbidden) {
      forbiddenFlag = forbidden;
      continue;
    }
    if (!token.startsWith('-') && prRef === undefined) {
      prRef = token;
    }
  }

  return { prRef, forbiddenFlag };
}

/** PURE: is this Bash command a `gh pr merge` attempt, and if so what ref/forbidden flag
 * does it carry? Anchored at real command boundaries: the command is split into subcommands
 * (on unquoted `&&`/`||`/`;`/`|`/newline, quote-aware, so a quoted span is one token and can
 * never itself split a command), and EVERY subcommand is inspected for a `gh pr merge`
 * invocation — not just the first — so a forbidden flag on a second, later `gh pr merge` in
 * a chained command (`gh pr merge 1 --merge && gh pr merge 2 --admin`) is still caught, and
 * a prefix ahead of the invocation in its own subcommand (`cd repo && gh pr merge ...`,
 * `sudo gh pr merge --admin`, `GH_TOKEN=x gh pr merge --admin`) still matches. A command that
 * only MENTIONS the phrase inside a quoted argument (`git commit -m "...gh pr merge..."`)
 * does not match, because the quoted span is one token, never three consecutive ones. */
export function parseMergeCommand(command: string): ParsedMergeCommand {
  const invocations = tokenizeShellCommand(command)
    .map(extractMergeInvocation)
    .filter((invocation): invocation is { prRef?: string; forbiddenFlag?: string } => invocation !== null);

  if (invocations.length === 0) {
    return { isMerge: false, prRef: undefined, forbiddenFlag: undefined };
  }

  let forbiddenFlag: string | undefined;
  let prRef: string | undefined;
  for (const invocation of invocations) {
    if (forbiddenFlag === undefined) forbiddenFlag = invocation.forbiddenFlag;
    if (prRef === undefined) prRef = invocation.prRef;
  }

  return { isMerge: true, prRef, forbiddenFlag };
}

/** PURE: judges the parsed `gh pr checks --json name,state` output. A parse failure or an
 * empty check list is NOT green — fail-closed, never "no checks means nothing to block". */
export function judgeChecks(stdout: string): JudgeChecksResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { allGreen: false, notGreen: ['gh pr checks output was not valid JSON (fail-closed)'] };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { allGreen: false, notGreen: ['gh pr checks returned no checks — an empty list is not green'] };
  }

  const notGreen = (parsed as Array<{ name?: unknown; state?: unknown }>)
    .map((entry) => ({
      name: typeof entry?.name === 'string' ? entry.name : 'unknown',
      state: typeof entry?.state === 'string' ? entry.state : 'unknown',
    }))
    .filter((check) => check.state !== 'SUCCESS')
    .map((check) => `${check.name}: ${check.state}`);

  return { allGreen: notGreen.length === 0, notGreen };
}

/** Steers, not just refuses (same principle as `BACKGROUNDING_DENIED_REASON` in
 * session.ts): both forbidden flags share one deny reason since neither is ever legitimate
 * on this gate. */
export const MERGE_GATE_DENIED_FORBIDDEN_FLAG_REASON =
  'Merge denied: `--auto` and `--admin` are forbidden on `gh pr merge` in this session — ' +
  '`--auto` ends the session before DoD (Definition of Done) cleanup can run, and `--admin` ' +
  'bypasses the pre-merge check gate entirely. Wait for every PR check to conclude green ' +
  '(`gh pr checks <pr> --watch`, timeout: 600000), then retry with a plain `gh pr merge --merge`. ' +
  "If a check is red for reasons outside this card's diff, escalate NEEDS_DIRECTION instead of merging.";

/** The `gh pr checks` call itself failed (no PR, network, auth) — fail-closed: an unreadable
 * check state is treated exactly like a red one, never like "nothing to block". */
export const MERGE_GATE_DENIED_CHECKS_ERROR_REASON =
  'Merge denied: could not verify checks — run `gh pr checks` yourself, get full green, then ' +
  'retry the merge.';

/** Builds the steering reason for a merge attempt whose checks are not all green. */
export function mergeGateNotGreenReason(prRef: string | undefined, notGreen: string[]): string {
  const watchCmd = prRef ? `gh pr checks ${prRef} --watch` : 'gh pr checks --watch';
  return (
    `Merge denied: not all checks have concluded green (${notGreen.join(', ')}) — pending is ` +
    `not green. Wait in the foreground with \`${watchCmd}\` (timeout: 600000), then retry the ` +
    "merge once every check is SUCCESS. If a check is red for reasons outside this card's " +
    'diff, escalate NEEDS_DIRECTION instead of merging.'
  );
}

/** Spec §4.6: green checks are not enough — the head being merged must be the exact commit the
 * runner ran the Done commands on. Steers the session back through `TASK_DONE` to get it there. */
export function MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON(headSha: string | null, doneSha: string | null): string {
  return (
    `Merge denied: the PR head (${headSha ?? 'unreadable'}) is not the commit whose Done commands the runner last ` +
    `passed (${doneSha ?? 'none yet'}). End your turn with \`TASK_DONE <last-task-id> <branch>\` so the runner ` +
    're-runs the Done commands on your latest commit, then merge when it sends you back to delivery.'
  );
}

function deny(reason: string): HookDecision {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/** PURE: the full decision for one PreToolUse event, given the already-parsed command and
 * (if the edge attempted it) the already-run `gh pr checks` result, the PR head, and the Done
 * commit. Order: forbidden flag, then checks green, then head == Done commit. Non-merge commands get
 * an empty decision (no opinion) — this function never decides anything about a tool call
 * that isn't a `gh pr merge` attempt. */
export function buildMergeGateDecision(input: MergeGateDecisionInput): HookDecision {
  const { parsed, checksExec } = input;
  if (!parsed.isMerge) return {};

  if (parsed.forbiddenFlag) {
    return deny(MERGE_GATE_DENIED_FORBIDDEN_FLAG_REASON);
  }

  if (!checksExec || checksExec.exitCode !== 0) {
    return deny(MERGE_GATE_DENIED_CHECKS_ERROR_REASON);
  }

  const judged = judgeChecks(checksExec.stdout);
  if (!judged.allGreen) {
    return deny(mergeGateNotGreenReason(parsed.prRef, judged.notGreen));
  }

  const headIsDoneCommit = !!input.headSha && !!input.doneSha && input.headSha === input.doneSha;
  if (!headIsDoneCommit) {
    return deny(MERGE_GATE_DENIED_HEAD_NOT_DONE_REASON(input.headSha ?? null, input.doneSha ?? null));
  }

  return {};
}
