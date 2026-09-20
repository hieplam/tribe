/**
 * The D5 ratchet, pure (card watchdog-stall-after-quota-relaunch). The measured field baseline
 * across the three recorded campaign homes was 11 false stalls out of 11 recorded stalls — every
 * one of them the event immediately after a `launch`/`relaunch`, each naming a log belonging to a
 * PREVIOUS run. The target is 0, and it may never rise again.
 *
 * Pure in, pure out: the caller reads and parses the `events.jsonl`; nothing here touches the
 * filesystem or the clock, so it is table-testable and can be pointed at any campaign home.
 */

export interface ReplayEvent {
  at: string;
  action: string;
  detail?: Record<string, unknown>;
}

export interface FalseStall {
  /** The `stall` event's own timestamp, verbatim. */
  stallAt: string;
  /** `launch` or `relaunch` — the spawn this stall followed. */
  afterAction: string;
  /** That spawn's timestamp, verbatim. */
  afterAt: string;
  /** Milliseconds between the spawn and the stall, or `null` when either timestamp is
   * unparseable (the fail-closed case: reported, never silently cleared). */
  gapMs: number | null;
}

/** Goal 3's window: "zero `stall` events within 30 min of their `relaunch` events." */
export const DEFAULT_WINDOW_MS = 30 * 60_000;

/**
 * Every `stall` that follows a `launch`/`relaunch` within `windowMs` (boundary inclusive).
 *
 * Fail closed (`~/.claude/rules/fail-closed-edges.md`): a `stall` whose own timestamp, or whose
 * preceding spawn's timestamp, cannot be parsed is REPORTED with `gapMs: null` rather than
 * assumed innocent — a stall this function cannot time is not a stall it has cleared.
 */
export function countFalseStalls(
  events: readonly ReplayEvent[],
  windowMs: number = DEFAULT_WINDOW_MS,
): FalseStall[] {
  const hits: FalseStall[] = [];
  let lastSpawn: ReplayEvent | null = null;
  for (const event of events) {
    if (event.action === 'launch' || event.action === 'relaunch') {
      lastSpawn = event;
      continue;
    }
    if (event.action !== 'stall' || lastSpawn === null) continue;
    const spawnMs = Date.parse(lastSpawn.at);
    const stallMs = Date.parse(event.at);
    if (Number.isNaN(spawnMs) || Number.isNaN(stallMs)) {
      hits.push({ stallAt: event.at, afterAction: lastSpawn.action, afterAt: lastSpawn.at, gapMs: null });
      continue;
    }
    const gapMs = stallMs - spawnMs;
    if (gapMs >= 0 && gapMs <= windowMs) {
      hits.push({ stallAt: event.at, afterAction: lastSpawn.action, afterAt: lastSpawn.at, gapMs });
    }
  }
  return hits;
}
