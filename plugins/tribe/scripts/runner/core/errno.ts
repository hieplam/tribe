// The one named parser for a caught filesystem error's `code` (`rule-one-parser-per-edge-shape`,
// spec §5(a)/§5(b)). Fourteen sites across cli/main.ts, adapters/cut.ts and three adapters
// narrowed `err.code` two different ways: a guarded membership check on the `code` property
// (G-004's fingerprint, two byte-identical copies) and a bare `(err as { code?: string }).code`
// cast at a lower rigor (twelve sites, no narrowing at all). This is the single narrowing both
// replace.
//
// PURE (`pure-core.md`): no fs, no clock, no globals — a value in, a value out. FAIL-CLOSED
// (`fail-closed-edges.md`): every shape degrades to `null`; it never throws.

/** The `code` a caught filesystem error carries, or `null` when `err` has none — including the
 * `null`/`undefined` case a bare `(err as { code?: string }).code` cast would have thrown on
 * reading `.code` off. That is the one intended behavioural difference this parser introduces
 * over the bare cast it replaces (spec §5): a strict improvement, never a regression, because a
 * catch handler comparing a `null` code against a string literal ('ENOENT', 'EEXIST', ...) behaves
 * identically to comparing `undefined` against it — both are false. */
export function errorCode(err: unknown): string | null {
  if (err === null || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
