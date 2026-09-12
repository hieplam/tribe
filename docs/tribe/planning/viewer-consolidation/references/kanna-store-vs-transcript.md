# Kanna's own store vs the Claude transcript — measured (2026-09-11, opus)
CC version on this machine 2.1.267; corpus 181 session files + 724 subagent files, 566 MB, largest 13 MB.

## ~/.kanna layout
data/chats.jsonl, projects.jsonl, turns.jsonl, queued-messages.jsonl, schedules.jsonl (op logs, v3 ops, ~56 op types); boards.db (SQLite); settings.json; transcripts/<chatId>.jsonl (normalized TranscriptEntry, 27 kinds, with debugRaw = the ORIGINAL Claude row as a string on ~all entries → Kanna's store is a superset). No snapshot.json until metadata logs > 2 MiB.

## Why Kanna keeps a store
2A Product scope (dominant): multi-provider (Claude/Codex/OpenRouter in one chat), chat != session (rename, archive, share, queue, schedule, boards, tool-approval, own subagents), durable send-side state (ADR queued-message-dequeue-on-commit), import-for-resume.
2B Transcript-format limitations (real, secondary, several since fixed upstream):
 L1 no `result` row on disk EVER (0/181 files, any version, any entrypoint) → cost/duration/usage are stream-only.
 L2 format drift: system rows (turn_duration/init/compact_boundary) vanished at 2.1.211–2.1.215 and RETURNED at ~2.1.233; Kanna's stop_reason heuristic encodes a closed window. cost-state rows from 2.1.246; custom-title from 2.1.267.
 L3 tool_result inside user rows; now also sourceToolAssistantUUID.
 L4 content string OR array (152 array vs 11 string in one file).
 L5 model:"<synthetic>" overloaded (api error / refusal / no-op) → flags+text heuristic.
 L6 which-file-is-mine race → ~/.claude/sessions/<pid>.json registry. SPAWN-SIDE only.
 L7 cwd encoding non-injective → but `cwd` is on most rows (339/524), read it directly.
 L8 subagent link via toolUseResult.agentId sidecar; subagents/agent-<id>.meta.json has parentAgentId + spawnDepth → tree by glob.
 L9 stream-only events: measured 9.2% of one Kanna chat's 6,117 entries exist nowhere on disk (task_notification 387, background_tasks_changed 134, system/init 22, result 21).
2C Operational: 220 MB RSS for 4 transcripts; 75 pm2 restarts/day at 96 MB transcript; byte-size-keyed cache; fs.watch stalls → 50 ms stat poll.

## Combination
Read time: UI reads ONLY ~/.kanna transcripts; never Claude's file. Write: one-way Claude file → Kanna store (PTY 50 ms poll; import delta by uuid; followed import 2 s). User send = permanent stop following. Last-writer-wins, dedup only.

## For a READ-ONLY viewer
Vanishes: all of 2A; result synthesis (no agent loop); discovery race (never spawns); dedup layers (0 duplicate uuids in 181 files); takeover; RSS crises (stream + window instead of materialize).
Handleable at parse/render time, zero persistence: tool pairing (Map by tool_use_id), string/array, synthetic badge, cwd from rows, subagents by glob + meta.json, compaction via isCompactSummary boolean (Kanna uses a string prefix), file order (0 dangling parentUuid; do NOT sort by timestamp: 791 inversions), slash-command/system-reminder XML chips, <persisted-output> → <session>/tool-results/<id>.txt on expand, base64 images, titles from ai-title (130/181 files) / custom-title / last-prompt (176/181) at list time, tail by stat-diff + partial-line buffer (Kanna's offset is in-memory too), listing by head+tail reads only.
Genuinely lost: L9 stream-only events (cosmetic for a viewer: no per-turn cost footer, no bg-task chips). Per-turn usage can be summed from assistant rows; cost from cost-state deltas (2.1.246+).
Genuinely needs persistence: user facts only — hidden/archived, viewer-side renames, read markers, tags, bookmarks → one small prefs JSON keyed by sessionId. A preferences file, not a transcript store.
