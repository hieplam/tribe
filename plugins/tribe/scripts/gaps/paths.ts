// paths.ts — pure path-overlap predicates for the gap capability (card C1). Extracted from
// gap-reconcile.ts so the candidate parser and the reconciler share ONE definition of "these
// two paths are the same gap's territory". Pure module: no fs, no subprocess, no clock.

/** A directory-comparable form of `p`: exactly one trailing slash. */
export function normalizeDir(p: string): string {
  return p.endsWith('/') ? p : `${p}/`;
}

/** True if `a` and `b` overlap — equal, or one is a directory-prefix of the other. The
 * normalizeDir call is what keeps `lib` from matching `library/a.ts` (spec §3 / §6a scenario 3). */
export function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return b.startsWith(normalizeDir(a)) || a.startsWith(normalizeDir(b));
}

export function anyPathOverlap(pathsA: readonly string[], pathsB: readonly string[]): boolean {
  return pathsA.some((a) => pathsB.some((b) => pathsOverlap(a, b)));
}
