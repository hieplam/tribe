# Viewer consolidation — references

Research and visualization artifacts behind the viewer redesign spec (Option A, approved by the
owner on 2026-09-11). The spec itself lives one level up as `spec.md` / `spec.html` once written.

| File | What |
| --- | --- |
| `walkthrough.html` | First-timer walkthrough of the viewer as it was before the redesign: screens, disk trees, flow diagram. Screenshots in `walkthrough/`. |
| `option-a.html` | The approved direction: single surface over `~/.claude/projects`, campaign badge from `campaign-state.json` + `run.json`, watchdog explained, what gets deleted. |
| `tribe-viewer-research.md` | Audit of the pre-redesign viewer and runner launch path: modes, pipeline, 25 findings (3 blockers), sizes. |
| `kanna-research.md` | Map of Kanna's discovery / tail / parse / render path (file:line into the Kanna repo). |
| `runner-log-vs-transcript.md` | Measurement: the runner's per-session log is 83.6% a verbatim copy of the Claude transcript; who reads it and what only it carries. |
| `kanna-store-vs-transcript.md` | Why Kanna keeps its own store; transcript-format limitations verified on 181 real sessions; what a read-only viewer needs to persist (nothing). |
| `*.review.jsonl` | Blind-reader review logs for the two HTML pages (Sonnet for the walkthrough, GPT-5.6 Terra for Option A). |

The `.body.html` files are the source fragments; the `.html` files are rendered with the owner's
Reading design system and open standalone in a browser. Mermaid loads from a CDN at view time.
