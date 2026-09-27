---
target: c3-215
scope: block
base: c3-215#n2199@v1:sha256:59f7674258812d07ad1dfe83eca18d999b114aa44a550a084cc28e8e83ff21f5
---
| rule-sessions-start-in-target-repo | rule | core/supervisor/session.ts#buildOneShotOptions and core/session.ts#buildSessionOptions (both spawn paths) | binding | Card supervisor-sessions-in-repo (D2): every session the tribe spawns starts in the target repo, never under `~/.tribe`, and loads only the configuration the owner's own `claude` loads there; sessions hand over through notes (state files), never through configuration; adopted 2026-09-27; supersedes the retired one-shot config-restore rule (its snapshot/restore guard no longer applies once nothing spawns with the campaign home as `cwd`) |
