---
target: c3-217
scope: block
base: c3-217#n2339@v1:sha256:f714eefd19e014f819b9c8ef2c27c61418074e746ff40be0a1d05d69fb0ad03f
---
| scripts/verify-shipped.sh | IN/OUT | Read-only against git/GitHub; prints 4 pass/fail lines + verdict — pr_merged, master_in_sync, worktree_removed, and gap_gate_stamped (the merged PR body carries a gap-gate v1 stamp whose card= matches --card, spec CU-4 §3). --pr, --worktree and --card are all required: a claimed-done state with an unchecked corner is the gap this skill exists to close. --skip-gap-gate is opt-in: it reports gap_gate_stamped as skipped and the verdict is decided by the other three checks — used by the campaign supervisor's closing re-verification, whose plans need not run the gap gate; without the flag the stamp is always required. The stamp's sha ancestry is deliberately not re-checked here, and the campaign runner's own done check never checks the stamp at all | shell CLI | plugins/verify-shipped/scripts/tests/test-verify-shipped.sh |
