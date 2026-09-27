---
target: c3-215
scope: block
base: c3-215#n2290@v1:sha256:dc6cff4e0f0d6b639ee2d01fb1966a8f2b525fd4249a23fb6497e3028d4b500e
---
| Runner accepts an unshipped card, or wedges the campaign | Editing verify.ts (the D3 six-point replay: merged, mergeShaAncestorOfMaster, checksGreen, worktreeAndBranchGone, schemaGuard, localBaseSynced), core/residue.ts#decideBaseSyncHeal or core/loop/card-actions.ts#healSafeResidue (the fast-forward heal), or any gh/git invocation in the runner | Mocked seams validate logic but NOT the commands: gh api pulls/<pr> 404d in reality while 25 tests passed, which would have failed every card forever. A wrong invocation is invisible to the suite | cd plugins/tribe/scripts/runner && bun test && bunx tsc --noEmit; plus execute any changed gh/git command against a real repo before trusting it |
