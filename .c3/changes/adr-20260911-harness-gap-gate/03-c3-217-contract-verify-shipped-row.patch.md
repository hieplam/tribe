---
target: c3-217
scope: block
base: c3-217#n1594@v1:sha256:32e5600a83f4ff3c24a3769f94ec70b414c964bce2c954f8e4c6afc391c1f191
---
scripts/verify-shipped.sh | IN/OUT | Read-only against git/GitHub; prints 4 pass/fail lines + verdict — pr_merged, master_in_sync, worktree_removed, and gap_gate_stamped (the merged PR body carries a gap-gate v1 stamp whose card= matches --card, spec CU-4 §3). --pr, --worktree and --card are all required: a claimed-done state with an unchecked corner is the gap this skill exists to close. Sha ancestry is deliberately not re-checked here — that is the campaign runner's gapGateStamped point, which has the merged repo in hand | shell CLI | plugins/verify-shipped/scripts/tests/test-verify-shipped.sh
