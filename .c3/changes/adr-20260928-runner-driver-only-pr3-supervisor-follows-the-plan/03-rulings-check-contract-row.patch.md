---
target: c3-215
scope: insert
base: c3-215#n2282@v1:sha256:166f3153f9db12c89c50e4a492aec0936fda5340330d6afe1163d73c38f22a80
---
| scripts/gaps/rulings-check.ts (ratification check) | IN | The Tribe-side ratification check for a campaign's answers.md, moved out of the campaign runner (runner-driver-only D3/D6: the runner, watchdog and supervisor require no ratification, and the runner never exits 5). bun rulings-check.ts <answers.md>: exit 0 when every ## ruling block carries a recognised ratified-as: value (rule <path> / debt <id> / roadmap <ref> / operational / dismissed, optionally suffixed (G-NNN); pending and any other value stay unratified — strict by design) or there are none, exit 1 printing one unratified ruling id per line, exit 2 on a missing argument or an unreadable file (one typed stderr line, never a stack trace). Parsing reuses the runner's pure core/rulings.ts#parseRulings — the Tribe side depends on the runner, never the reverse. A Tribe-style plan (orchestrate-campaign's "Tribe style — Stage C and D additions") runs it as a Done command | bun CLI, repo-invoked (never installed) | plugins/tribe/scripts/gaps/rulings-check.test.ts |

