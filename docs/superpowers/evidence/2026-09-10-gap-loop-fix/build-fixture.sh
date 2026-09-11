#!/usr/bin/env bash
# build-fixture.sh — empty-fixture reproduction of "the harness-gap loop never records a ledger event".
# Builds a bare git repo with ONE planted gap (silent `catch {}` in 3 files, error-handling category,
# no written rule), one card whose plan adds a 4th file following the same pattern, a campaign home,
# and prints the runner launch line. Usage: build-fixture.sh <label> [<github-remote-url>]
# With a GitHub remote the fixture gets TWO cards (C1 add-reader, C2 add-formatter depending on C1) so the
# after-fix oracle can observe an `opened` event on C1's PR and a `seen` event on C2's; without one it keeps
# the single-card, local-bare-origin shape used for the before-fix reproduction.
set -euo pipefail
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
LABEL="${1:?label}"
REMOTE="${2:-}"
TRIBE_ROOT=/Users/hip/repo/tribe
TMP="$(mktemp -d /tmp/gap-repro-XXXXXX)"
REPO="$TMP/repo"; mkdir -p "$REPO/src" "$REPO/test" "$REPO/docs/specs" "$REPO/docs/plans"
cd "$REPO"
git init -q -b master
GA=(-c user.email=gap-repro@example.com -c user.name="Gap Repro Fixture")
cat > package.json <<'J'
{ "name": "gap-repro-fixture", "private": true, "type": "module", "scripts": { "test": "bun test" } }
J
cat > README.md <<'R'
# gap-repro fixture

Tiny config-loading library. Run `bun test`.
R
for m in loader parser writer; do
cat > "src/$m.ts" <<T
// $m.ts — reads its input, never throws: a bad input yields the fallback.
export function $m(input: string, fallback: string): string {
  try {
    return JSON.parse(input).value as string;
  } catch {}
  return fallback;
}
T
done
cat > test/modules.test.ts <<'T'
import { expect, test } from 'bun:test';
import { loader } from '../src/loader.ts';
import { parser } from '../src/parser.ts';
import { writer } from '../src/writer.ts';
test('loader falls back on bad input', () => { expect(loader('nope', 'x')).toBe('x'); });
test('parser falls back on bad input', () => { expect(parser('nope', 'y')).toBe('y'); });
test('writer falls back on bad input', () => { expect(writer('nope', 'z')).toBe('z'); });
T
cat > docs/specs/add-reader-spec.md <<'S'
# Spec: add-reader

## Goal
Add a fourth module, `src/reader.ts`, exporting `reader(input: string, fallback: string): string`,
matching the existing modules' contract exactly: it parses `input` as JSON and returns its `value`
field, and on ANY failure returns `fallback` without throwing.

## Requirements
- `src/reader.ts` follows the same error-handling style as `src/loader.ts`, `src/parser.ts` and
  `src/writer.ts` (read them first; consistency with the existing modules is required).
- `test/reader.test.ts` covers the happy path and the fallback path.
- `bun test` stays green.

## Non-goals
- No changes to the three existing modules.
S
cat > docs/plans/add-reader-plan.md <<'P'
# Plan: add-reader

## Global Constraints
- Dispatch the implementation task to the `hunter` subagent per your Method; never write source inline.
- Keep the change to `src/reader.ts` and `test/reader.test.ts`. No other files.
- Consistency wall: `src/reader.ts` mirrors `src/loader.ts` line for line except the function name.

## Task 1: Add `src/reader.ts` with tests
- [ ] Step 1: Write the failing test `test/reader.test.ts`: `reader('{"value":"ok"}','f')` is `'ok'`; `reader('nope','f')` is `'f'`. Run `bun test` (expected: fails, module missing).
- [ ] Step 2: Implement `src/reader.ts` mirroring `src/loader.ts` (same try/catch shape, same fallback behaviour).
- [ ] Step 3: Run `bun test` (expected: green).
- [ ] Step 4: Commit both files.
P
if [ -n "$REMOTE" ]; then
cat > docs/specs/add-formatter-spec.md <<'S'
# Spec: add-formatter

## Goal
Add a fifth module, `src/formatter.ts`, exporting `formatter(input: string, fallback: string): string`,
matching the existing modules' contract exactly (parse `input` as JSON, return its `value`, return
`fallback` on ANY failure without throwing).

## Requirements
- `src/formatter.ts` follows the same error-handling style as `src/loader.ts` and `src/reader.ts` (read them
  first; consistency with the existing modules is required).
- `test/formatter.test.ts` covers the happy path and the fallback path.
- `bun test` stays green.

## Non-goals
- No changes to the existing modules.
S
cat > docs/plans/add-formatter-plan.md <<'P'
# Plan: add-formatter

## Global Constraints
- Dispatch the implementation task to the `hunter` subagent per your Method; never write source inline.
- Keep the change to `src/formatter.ts` and `test/formatter.test.ts`. No other source files.
- Consistency wall: `src/formatter.ts` mirrors `src/reader.ts` line for line except the function name.

## Task 1: Add `src/formatter.ts` with tests
- [ ] Step 1: Write the failing test `test/formatter.test.ts`: `formatter('{"value":"ok"}','f')` is `'ok'`; `formatter('nope','f')` is `'f'`. Run `bun test` (expected: fails, module missing).
- [ ] Step 2: Implement `src/formatter.ts` mirroring `src/reader.ts` (same try/catch shape, same fallback behaviour).
- [ ] Step 3: Run `bun test` (expected: green).
- [ ] Step 4: Commit both files.
P
fi
git add -A
git "${GA[@]}" commit -q -m "seed: three modules, tests, and the add-reader card"
# bare "origin" so push succeeds; there is no GitHub, so gh pr create cannot succeed — the reconcile
# step precedes PR creation in warchief step 7, which is what this reproduction observes.
if [ -n "$REMOTE" ]; then
  git remote add origin "$REMOTE"
  git push -q -u origin master --force
else
  git init -q --bare "$TMP/origin.git"
  git remote add origin "$TMP/origin.git"
  git push -q -u origin master
fi
HOME_LINE="$(bash "$TRIBE_ROOT/plugins/tribe/scripts/tribe-home.sh" "$REPO")"
CAMP="$HOME_LINE/campaigns/$LABEL"; mkdir -p "$CAMP"; : > "$CAMP/answers.md"
cat > "$CAMP/campaign-state.json" <<J
{ "v": 1, "campaign": "$LABEL", "planning": { "mode": "shaman" }, "mergePolicy": "regular-merge-only",
  "sequence": [$( [ -n "$REMOTE" ] && echo '"C1", "C2"' || echo '"C1"' )], "schemaLockPaths": [], "docsOnlyPaths": [], "ownerOnlyEscalations": [],
  "cards": { "C1": { "status": "staged", "spec": "docs/specs/add-reader-spec.md", "plan": "docs/plans/add-reader-plan.md",
    "branch": null, "baseSha": null, "pr": null, "mergeSha": null, "sessionId": null, "updatedAt": null, "autoAnswerRounds": 0 }$( [ -n "$REMOTE" ] && echo ',
    "C2": { "status": "staged", "spec": "docs/specs/add-formatter-spec.md", "plan": "docs/plans/add-formatter-plan.md",
    "branch": null, "baseSha": null, "pr": null, "mergeSha": null, "sessionId": null, "updatedAt": null, "dependsOn": ["C1"], "autoAnswerRounds": 0 }' ) } }
J
echo "REPO=$REPO"; echo "CAMP=$CAMP"; echo "TMP=$TMP"
echo "planted gap hits:"; grep -rn 'catch {}' src | wc -l
