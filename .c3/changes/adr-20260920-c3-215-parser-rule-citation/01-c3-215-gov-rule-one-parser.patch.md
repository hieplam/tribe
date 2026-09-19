---
target: c3-215
scope: insert
base: c3-215#n1764@v1:sha256:12132dc9df2539161d71de3a5bd4e4b39d1ab8a9d896ebcc5fdd484ba09501f1
---
| rule-one-parser-per-edge-shape | rule | The runner's four named edge parsers: core/errno.ts#errorCode (a caught filesystem error's code), core/escalation.ts#parseEscalationQuestion (the escalation-file shape, three read sites collapsed to one), core/state.ts's CampaignStateSchema reused read-only via loop.ts's private readCampaignState, and core/metrics/ratchet-gate.ts#checkRatchetRevision's raisedBy/ceilings shape | binding | Paydown of harness gap G-004 (2 identical `'code' in err` narrowings plus 12 lower-rigor bare casts, 2 inline campaign-state.json re-reads, 3 escalation-file read sites); adopted 2026-09-19, cleared by supervisor-hardening card Phase 3 (plan Tasks 14-16) |
