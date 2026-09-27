// core/plan-index.ts — reads a card's markdown plan into its task index (card runner-driver-only,
// spec §4.3, D1/D2). PURE: the plan text arrives as an argument; nothing here touches a file.
//
// Oracle: spec §4.3 is the contract — CommonMark is NOT. Under-reading a Done command (missing one,
// or attributing it to the wrong task) is a bug; refusing an ambiguous plan is by design.

import type { TaskRef } from './types.ts';

export type { TaskRef };

export interface ResolvedTask {
  id: string;
  heading: string;
  doneCommands: string[];
}

export type TaskIndexProblem =
  | 'dangling_heading'
  | 'duplicate_heading'
  | 'missing_done'
  | 'ambiguous_done'
  | 'missing_done_block'
  | 'empty_done'
  | 'continuation_not_supported';

export interface TaskIndexIssue {
  cardId: string;
  taskId: string;
  heading: string;
  problem: TaskIndexProblem;
}

export interface PlannedCommand {
  command: string;
  /** Every task id (in plan order) whose Done section lists this exact command. */
  tasks: string[];
}

interface Heading {
  level: number;
  text: string;
  /** 0-based line index. */
  line: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

interface Scan {
  lines: string[];
  headings: Heading[];
  /** For each line: is it a fence line or inside a fenced block? */
  inFence: boolean[];
  /** Line indexes that OPEN a fenced block. */
  fenceOpens: Set<number>;
}

/** Fences are tracked CommonMark-style: a fence opened by N backticks (or tildes) closes only on a
 * line of at least N of the SAME character — the rule validate-plan.sh already implements. A heading
 * inside a fence is content, never structure. */
function scan(markdown: string): Scan {
  const lines = markdown.split('\n');
  const headings: Heading[] = [];
  const inFence: boolean[] = [];
  const fenceOpens = new Set<number>();
  let open: { char: string; length: number } | null = null;
  lines.forEach((line, i) => {
    if (open !== null) {
      inFence.push(true);
      const close = new RegExp(`^ {0,3}${open.char === '`' ? '`' : '~'}{${open.length},}\\s*$`);
      if (close.test(line)) open = null;
      return;
    }
    const fence = FENCE_OPEN_RE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      open = { char: marker[0] as string, length: marker.length };
      inFence.push(true);
      fenceOpens.add(i);
      return;
    }
    inFence.push(false);
    const heading = HEADING_RE.exec(line);
    if (heading) headings.push({ level: (heading[1] as string).length, text: (heading[2] as string).trim(), line: i });
  });
  return { lines, headings, inFence, fenceOpens };
}

type TaskResolution = { ok: true; task: ResolvedTask } | { ok: false; problem: TaskIndexProblem };

function resolveOne(s: Scan, ref: TaskRef): TaskResolution {
  const matches = s.headings.filter((h) => h.text === ref.heading);
  if (matches.length === 0) return { ok: false, problem: 'dangling_heading' };
  if (matches.length > 1) return { ok: false, problem: 'duplicate_heading' };
  const task = matches[0] as Heading;
  // The task section ends at the next heading of the same or a higher level (fewer or equal #s).
  const sectionEnd = s.headings.find((h) => h.line > task.line && h.level <= task.level)?.line ?? s.lines.length;
  const inSection = s.headings.filter((h) => h.line > task.line && h.line < sectionEnd);
  const doneHeadings = inSection.filter((h) => h.level > task.level && h.text.toLowerCase() === 'done');
  if (doneHeadings.length === 0) return { ok: false, problem: 'missing_done' };
  if (doneHeadings.length > 1) return { ok: false, problem: 'ambiguous_done' };
  const done = doneHeadings[0] as Heading;
  // The Done block must sit between the Done heading and the next heading of ANY level.
  const blockLimit = inSection.find((h) => h.line > done.line)?.line ?? sectionEnd;
  let openLine = -1;
  for (let i = done.line + 1; i < blockLimit; i++) {
    if (s.fenceOpens.has(i)) {
      openLine = i;
      break;
    }
  }
  if (openLine < 0) return { ok: false, problem: 'missing_done_block' };
  const body: string[] = [];
  for (let i = openLine + 1; i < s.lines.length && s.inFence[i] === true && !s.fenceOpens.has(i); i++) {
    body.push(s.lines[i] as string);
  }
  // The loop above also collects the closing fence line (it is `inFence`); drop it.
  if (body.length > 0 && FENCE_OPEN_RE.test(body[body.length - 1] as string)) body.pop();
  const commands: string[] = [];
  for (const raw of body) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.endsWith('\\')) return { ok: false, problem: 'continuation_not_supported' };
    commands.push(line);
  }
  if (commands.length === 0) return { ok: false, problem: 'empty_done' };
  return { ok: true, task: { id: ref.id, heading: ref.heading, doneCommands: commands } };
}

/** Resolves every task of one card against its plan text. Collects EVERY issue (never first-fail),
 * so one refusal names everything the author must fix. */
export function resolveTaskIndex(
  cardId: string,
  refs: readonly TaskRef[],
  planMarkdown: string,
): { tasks: ResolvedTask[]; issues: TaskIndexIssue[] } {
  const s = scan(planMarkdown);
  const tasks: ResolvedTask[] = [];
  const issues: TaskIndexIssue[] = [];
  for (const ref of refs) {
    const r = resolveOne(s, ref);
    if (r.ok) tasks.push(r.task);
    else issues.push({ cardId, taskId: ref.id, heading: ref.heading, problem: r.problem });
  }
  return { tasks, issues };
}

/** The Done commands of tasks 0..`throughIndex` (inclusive), in plan order, deduplicated by exact
 * text — `go build ./...` asked for by four tasks runs once per Done run, recorded against all four. */
export function doneCommandsThrough(tasks: readonly ResolvedTask[], throughIndex: number): PlannedCommand[] {
  const planned: PlannedCommand[] = [];
  const byCommand = new Map<string, PlannedCommand>();
  for (const task of tasks.slice(0, throughIndex + 1)) {
    for (const command of task.doneCommands) {
      const existing = byCommand.get(command);
      if (existing) {
        if (!existing.tasks.includes(task.id)) existing.tasks.push(task.id);
        continue;
      }
      const entry = { command, tasks: [task.id] };
      byCommand.set(command, entry);
      planned.push(entry);
    }
  }
  return planned;
}
