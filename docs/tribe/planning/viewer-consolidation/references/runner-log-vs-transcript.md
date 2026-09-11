# Runner session log vs Claude transcript — measured (2026-09-11, opus)

## Writer
- ONE writer: runner/core/session.ts:266 `io.appendLog(logPath, JSON.stringify(message))` — the raw SDK message object, unmodified, one per line. Path `<logsDir>/<card>-<sessionId>.log` (session.ts:262). appendLog = writeFileSync append (run-io.adapter.ts:88-91). Runner stdout/stderr goes elsewhere (<home>/watchdog/runner-stdout/).

## Readers (complete)
- Watchdog: stall = newest log mtime (watch-loop.ts:163-165, select.ts:37-46); quota = rate_limit_event status=rejected + resetsAt (signals.ts:83-92 → decide.ts:92-120 wait_until); overload = result.api_error_status in {500,502,503,504,529} (signals.ts:94-101). Reads a 64 KiB tail. `lastResultIsError` computed but never consumed (dead).
- Viewer status page: 64 KiB / last 40 lines tail (scan.adapter.ts:20-21, 250-280) → derive.ts:116-126 → render.ts:88-93 <pre>. Consumes only file, mtimeIso, sizeBytes, tailLines.
- Nobody else: verify/report/residue/run-loop do not read it. Live view reads ONLY ~/.claude/projects.

## Measured diff, card C5 (gap-gate)
- log 1,458 lines / 1,788,155 B; transcript 260 lines / 987,007 B.
- log types: thinking_tokens 802, assistant 272, user 196, task_progress 131, task_started 24, task_notification 24, task_updated 6, init 1, result/success 1, rate_limit_event 1.
- transcript types: assistant 141, user 60, last-prompt 21, ai-title 20, attachment 14, queue-operation 2, pr-link 2.
- Parent assistant/user uuids: log 200, transcript 201; log-only 0; transcript-only 1 = the initial user prompt (executor brief; the SDK stream never echoes the prompt). Transcript is a strict superset at parent level.
- Subagent rows ARE inline in the log (268 rows, parent_tool_use_id != null); subagents/*.jsonl carry 368 uuids; log-only 0; sidecar-only 100 (all isMeta:true). Sidecars are a strict superset.
- Content of shared messages: byte-identical (200/200 C5; 167/167 C4). Only envelope differs (stop_reason null vs final, output_tokens partial vs final, iterations/speed).
- Byte breakdown C5: 83.6% verbatim duplicate of transcript+sidecars; thinking_tokens 8.8%; task_* ~4.1%; watchdog-unique content (init, result, rate_limit_event) 3,735 B = 0.2%.
- Log is per-RUN; transcript is per-SESSION cumulative across resumes (ab8cb8e6: 3 logs, 1 transcript containing all parent uuids). 12/12 logs have a matching transcript.

## What the transcript lacks / has in another shape (all 15 transcripts checked)
- No `result` rows, no `rate_limit_event` rows, no thinking_tokens/task_progress rows, no structured `resetsAt`.
- 429 IS in the transcript as an assistant row: {"apiErrorStatus":429,"isApiErrorMessage":true,"error":"rate_limit","message":{"model":"<synthetic>","content":[{"type":"text","text":"You've hit your session limit · resets 6:20am (Asia/Saigon)"}]}} — 1:1 with the log's rejected rate_limit_events (10 = 10). apiErrorStatus values seen: 429 ×18, 400 ×1. 529 never observed on this machine (fixture is synthetic).

## Verdict
(a) The browser reads two files for the same session: status page tail = runner log; live page = transcript. 83.6% same bytes rendered two ways.
(b) The runner log carries NOTHING a viewer needs that the transcript lacks. resetsAt + result row are watchdog-only.
(c) Watchdog: stall → transcript mtime works (max intra-run gap 542s vs 30-min default). 429-happened → transcript isApiErrorMessage works. resetsAt → NOT in transcript (only the human string). 5xx/529 → unknown, plausibly apiErrorStatus (inference). Switching the watchdog to transcripts would also require it to resolve sessionId via campaign-state + cwd encoding.
(d) If the viewer stops reading the log: status page loses its "Session tail" panel; dead types newestLog/sessionTail; scan.adapter loses ~80 lines; ~5 test files change. Watchdog, runner loop, resume, live view unaffected.
