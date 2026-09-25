---
target: rule-session-cwd-config-restored
scope: block
base: rule-session-cwd-config-restored#n2538@v1:sha256:ca3042e2a0ad5ee8691f87ce5f74a36209aa7a070e228a598957282fea18a09f
---
`core/supervisor/permit.ts` — the `HOME_CONFIG_DENIED_REASON` row in `decideContainmentHook`. This
layer is REQUIRED, not defence in depth: the restore above runs **after** the session, so it
structurally cannot reach two windows this card's own spec MEASURED **inside** one session.
(1) Spec §4.4 item 3, verbatim: *"**Settings reload mid-session.** e2's writer A itself left
`project-Stop` and `local-Stop` markers: the hooks it wrote with `Bash` were picked up by A's own
`Stop` event."* The spec dismisses it with *"`closing` already holds `Bash`, so it gains nothing"* —
true for `closing`, false for `ruling`/`ratify`, which hold `Write`/`Edit` while `Bash` sits in
`JUDGMENT_DISALLOWED_TOOLS`: without this refusal a deliberately shell-less judgment session can
write its own `hooks` block into `<home>/.claude/settings.json` and have its own `Stop` event run
that shell command, before any restore can run. (2) Spec §4.3 row `m1b`: a nested memory file loads
when the session reads a file in its directory, so a session that writes
`<home>/escalations/AGENTS.md` and then reads `<home>/escalations/card.md` joins its own planted
instruction to its own context. Honest limit, stated as a burden on any future deletion rather than
kept quiet: §4.4 item 3 measured the reload after a `Bash` write, and whether the Claude Code CLI's
reload keys on the *writing tool* is UNMEASURED — so whoever proposes removing this layer owes that
measurement first. Named gap, deliberately not built (card `supervisor-home-settings-containment`,
fix round 3): no test distinguishes the two layers today — the `Write`-writer E2E pairs assert an
attempted Write plus no carry-over, which holds if **either** layer works, and no pair plants and
reads within one session — and building one needs exactly the measurement above.
