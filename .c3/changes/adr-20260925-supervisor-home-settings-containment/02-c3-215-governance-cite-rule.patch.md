---
target: c3-215
scope: insert
base: c3-215#n2050@v1:sha256:9e168b83de5bdb4bf32cf210b9a3bdb8c3201f9260080989bfbbdd38cb507c95
---
| rule-session-cwd-config-restored | rule | core/supervisor/session.ts#runOneShotSession (the supervisor's one-shot spawn path) | binding | Card supervisor-home-settings-containment (spec §4, §6): a spawn path that loads the project/local settings tier restores its cwd's configuration surface to the pre-session snapshot before the next session can start; adopted 2026-09-25 |
