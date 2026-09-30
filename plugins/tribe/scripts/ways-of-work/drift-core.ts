// drift-core.ts — the PURE core of the ways-of-work drift counter (card ways-of-work-consolidation,
// G1; card ways-of-work-review-fixes, G1). Given file texts and a policy, it lists every place that
// states a way-of-work rule: a mode's rules, the campaign harness default, who executes on each
// path, and the final review's verdict rule. Nothing here touches the filesystem, git, the clock or
// the environment (pure-core.md): drift.ts reads the files and hands their text in.
//
// Oracle: the cards' G1 rows are the contract. A live file that restates a mode's rule, the harness
// default or the who-executes rule and is not listed is a bug (under-check). A pointer that gets
// listed is fixed by rewording the pointer so it defers to the canonical section, never by
// weakening a signal (over-check is visible and cheap).

/** One kind of rule sentence. Each pattern is matched against one line joined with the next one
 * (see `hitsIn`), so a sentence hard-wrapped across two lines is still caught. A pattern carries no
 * `g` flag: `exec` must search each joined line from its start. */
export interface Signal {
  name: string;
  pattern: RegExp;
}

/** The rule sentences a way-of-work definition is made of. A line matching any of these states a
 * mode's rule; outside the canonical section that is a second definition. */
export const SIGNALS: readonly Signal[] = [
  // When to use a mode: the task-count and change-size thresholds.
  { name: 'task-limit', pattern: /\b(?:at most|up to|no more than|fewer than|less than)\s*(?:2|two|3|three)\s+(?:build\s+)?tasks\b|[≤<]=?\s*(?:2|3)\s+(?:build\s+)?tasks\b|\b3\s*(?:to|-|–)\s*(?:~\s*|about\s+)?8\s+(?:build\s+)?tasks\b/i },
  { name: 'line-limit', pattern: /\b50\s+changed\s+lines\b/i },
  // How a light mode runs: its review and fix-round cap, and who implements each task.
  { name: 'fix-round-cap', pattern: /\b(?:at most|up to|no more than)\s+(?:one|1|two|2)\s+fix[- ]rounds?\b|[≤<]=?\s*(?:1|2)\s+fix[- ]rounds?\b|\bfix[- ]round cap\s+(?:of\s+)?(?:1|2|one|two)\b/i },
  { name: 'implementer-rule', pattern: /\b(?:one|a)\s+(?:fresh\s+)?(?:implementer|`?general-purpose`?)(?:\s+subagent)?\s+per\s+task\b|\bone\s+fresh\s+subagent\s+per\s+task\b|\bgiv(?:e|ing)\s+each\s+task\s+to\s+one\b|\bbuilds?\s+(?:every|each)\s+task\s+itself\b/i },
  // Who may choose the heavy mode: the retired "only when the owner asks" rule.
  { name: 'owner-must-ask', pattern: /\bunless\s+the\s+owner\s+(?:explicitly\s+)?(?:asks|says)\b|\bonly\s+when\s+the\s+owner\s+asks\b|\bthe\s+owner\s+named\s+no\s+style\b/i },
  // The retired second vocabulary: the campaign's plan styles.
  { name: 'plan-style', pattern: /\b(?:simple|tribe)\s+style\b|\bsimple\s+by\s+default\b|\bHow to work\b/i },
  // The rubric's own wording for the heavy mode and the tie-break.
  { name: 'rubric', pattern: /\bcould\s+pass\s+every\s+Verify\s+block\b|\bpick\s+the\s+lighter\s+mode\b/i },
  // The campaign harness, the default for every mode (never the eval harness, never the
  // harness-gap gate).
  { name: 'harness-default', pattern: /\bharness\b(?!-)[^.;]{0,80}?\b(?:by\s+default|the\s+default)\b|\bdefault\s+harness\b|\bdefault\s+for\s+every\s+(?:mode|way\s+of\s+work|approved\s+plan)\b|\bevery\s+(?:approved\s+)?(?:plan|mode|way\s+of\s+work)\b[^.;]{0,60}?\bharness\b(?!-)|\bharness\b(?!-)[^.;]{0,60}?\bevery\s+(?:mode|way\s+of\s+work|approved\s+plan)\b/i },
  // Only the owner's explicit words turn the harness off; a harness that cannot run blocks the card
  // and never falls back to an in-session path.
  { name: 'harness-off', pattern: /\b(?:unless|only\s+when|until)\s+the\s+(?:owner|user)\b[^.;]{0,50}?\b(?:not\s+to|don't|do\s+not)\b|\b(?:not\s+to|don't|do\s+not)\s+use\s+the\s+(?:campaign\s+|`?orchestrate-campaign`?\s+)?harness\b|\bowner's\s+explicit\s+(?:words|no-harness)\b|\bharness\s+that\s+cannot\s+run\b|\bnever\s+fall\s+back\b|\bfall(?:s|ing)?\s+back\s+(?:to|on)\s+(?:an?\s+in-session|step\s+6|your\s+own)\b/i },
  // Who executes, on each path: the runner's executor session, the owner's new session, the
  // Shaman's own session, the full-build Warchief the Shaman dispatches, who runs the post-merge
  // steps — and a mode named together with the no-harness path, which names one cell of that table.
  { name: 'who-executes', pattern: /\bowner's\s+new\s+(?:named\s+|execution\s+)?session\b|\bowner\s+opens\s+a\s+new\b|\b(?:your|its)\s+own\s+session\s+(?:builds|orchestrates|on\s+delegation)\b|\bfrom\s+(?:your|its)\s+own\s+session\b|\bdispatch(?:es)?\s+(?:its\s+)?(?:one\s+|a\s+)?full-build\b|\bexecutor\s+session\s+(?:acts\s+as|is)\s+(?:that|the)\s+Warchief\b|\bbuil(?:d|ds|t|ding)\s+(?:(?:a|the|every|each)\s+[^.;:]{0,30}?\s+)?inline\b|\bpost-merge\s+steps\b[^.;]{0,40}?\b(?:yourself|itself)\b|\bno-harness\s+`?(?:single-agent|subagent-per-task|tribe)\b|\b(?:single-agent|subagent-per-task|tribe)`?\s+(?:card|plan)\s+(?:run\s+)?without\s+the\s+(?:campaign\s+)?harness\b/i },
  // The final review's verdict rule: the ratings decide it, never the reviewer's discretion.
  { name: 'review-verdict', pattern: /\bShould-fix\s+or\s+worse\b|\bany\s+(?:Blocker\s+or\s+)?Should-fix\b[^.;]{0,60}?\bREVIEW:\s*FAIL\b|\bREVIEW:\s*PASS`?\s+that\s+lists\b|\bat\s+least\s+(?:a\s+)?Should-fix\b/i },
];

export interface FileText {
  /** Repo-relative path, forward slashes. */
  path: string;
  text: string;
}

export interface DriftPolicy {
  /** The one file allowed to define the ways of work. */
  canonicalPath: string;
  /** The heading text of the defining section inside that file. */
  canonicalHeading: string;
  /** Path prefixes never scanned: history, evidence, and the counter's own signals + fixtures. */
  allowPrefixes: readonly string[];
}

export interface Hit {
  line: number;
  signal: string;
  text: string;
}

/** A place that states way-of-work rules: a whole file, or the canonical section of the canonical file. */
export interface Place {
  path: string;
  /** true only for the canonical section itself — the one allowed definition. */
  canonical: boolean;
  hits: Hit[];
}

export interface DriftReport {
  /** Number of places that define the ways of work. The goal is exactly 1: the canonical section. */
  count: number;
  places: Place[];
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

/** 0-based [start, end) line range of the section whose heading text is `heading`, or null when the
 * file has no such heading. Fence-aware: a heading inside a fenced block is content, not structure. */
export function sectionRange(lines: readonly string[], heading: string): [number, number] | null {
  let open: { ch: string; len: number } | null = null;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = FENCE_RE.exec(line);
    if (open !== null) {
      if (fence && (fence[1] as string)[0] === open.ch && (fence[1] as string).length >= open.len && (fence[2] as string).trim() === '') open = null;
      continue;
    }
    if (fence) {
      open = { ch: (fence[1] as string)[0] as string, len: (fence[1] as string).length };
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (!h) continue;
    const hLevel = (h[1] as string).length;
    if (start < 0) {
      if ((h[2] as string) === heading) {
        start = i;
        level = hLevel;
      }
    } else if (hLevel <= level) {
      return [start, i];
    }
  }
  return start < 0 ? null : [start, lines.length];
}

/** The hits of lines [from, to). Prose is hard-wrapped, so a rule sentence can break across two
 * lines: each line is matched joined with the next line of the same range, and a hit belongs to the
 * line its match starts on — a sentence wholly on the next line is that line's hit, never both. */
function hitsIn(lines: readonly string[], from: number, to: number): Hit[] {
  const hits: Hit[] = [];
  for (let i = from; i < to; i++) {
    const text = lines[i] as string;
    const joined = i + 1 < to ? `${text} ${(lines[i + 1] as string).trimStart()}` : text;
    for (const signal of SIGNALS) {
      const match = signal.pattern.exec(joined);
      if (match !== null && match.index < text.length) hits.push({ line: i + 1, signal: signal.name, text: text.trim() });
    }
  }
  return hits;
}

/** Lists every place that states a way-of-work rule. Allowlisted paths are skipped; in the
 * canonical file, the canonical section is its own place, and everything outside it is a second one. */
export function findPlaces(files: readonly FileText[], policy: DriftPolicy): DriftReport {
  const places: Place[] = [];
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    if (policy.allowPrefixes.some((prefix) => file.path.startsWith(prefix))) continue;
    const lines = file.text.split('\n');
    const range = file.path === policy.canonicalPath ? sectionRange(lines, policy.canonicalHeading) : null;
    if (range === null) {
      const hits = hitsIn(lines, 0, lines.length);
      if (hits.length > 0) places.push({ path: file.path, canonical: false, hits });
      continue;
    }
    const inside = hitsIn(lines, range[0], range[1]);
    const outside = [...hitsIn(lines, 0, range[0]), ...hitsIn(lines, range[1], lines.length)];
    if (inside.length > 0) places.push({ path: `${file.path}#${policy.canonicalHeading}`, canonical: true, hits: inside });
    if (outside.length > 0) places.push({ path: file.path, canonical: false, hits: outside });
  }
  return { count: places.length, places };
}

/** The human-readable report: one line per place, then the count. */
export function renderReport(report: DriftReport): string {
  const lines = report.places.map((p) => `${p.canonical ? 'canonical ' : 'restates  '} ${p.path} (${p.hits.length} line${p.hits.length === 1 ? '' : 's'})`);
  lines.push(`ways-of-work definitions: ${report.count}`);
  return lines.join('\n');
}
