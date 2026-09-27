---
target: c3-215
scope: block
base: c3-215#n2199@v1:sha256:1e5b6ef777edd18cb1df641aaab38202e36bebfbb2d16c2258348b16c93340f7
---
| rule-sessions-start-in-target-repo | rule | core/supervisor/session.ts#buildOneShotOptions and core/session.ts#buildSessionOptions (both spawn paths) | binding | Card supervisor-sessions-in-repo (D2): every session the tribe spawns starts in the target repo, never under `~/.tribe`, and loads only the configuration the owner's own `claude` loads there; sessions hand over through notes (state files), never through configuration; adopted 2026-09-27; supersedes rule-session-cwd-config-restored (retired — the snapshot/restore guard it mandated no longer applies once nothing spawns with the campaign home as `cwd`) |
