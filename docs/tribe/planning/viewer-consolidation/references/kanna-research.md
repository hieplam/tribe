# Kanna — transcript discovery / tailing / parsing / rendering (research, 2026-09-11, sonnet)

## 1. Discovery
- encodeCwd: src/server/claude-pty/jsonl-path.adapter.ts:32-39 — realpath → NFC → replace /[^a-zA-Z0-9]/g with "-"; >200 chars truncated + hash suffix. Ported from claude-code sessionStoragePortable.ts.
- Decoding is heuristic: resolveEncodedClaudePath discovery.adapter.ts:28-56 splits on "-" and greedily rejoins the longest existing prefix.
- Project list: ClaudeProjectDiscoveryAdapter.scan() discovery.adapter.ts:97-134 — shallow readdir of ~/.claude/projects, dir mtime, title = basename. Scan-on-demand (boot, project open/create, import, WS subscribe). NO fs.watch.
- Session list (import only): scanClaudeSessions claude-session-scanner.adapter.ts:7-24 → parseClaudeSessionFile claude-session-parser.adapter.ts:18-69 reads WHOLE file, md5 sourceHash, sessionId/cwd from first record, first/last timestamp.
- No git branch read. Title: custom-title record → summary record → first user text → "Imported session" (claude-session-importer.adapter.ts:84-121).
- Bulk import materialises into Kanna's own event store (one-way). Delta = uuid dedupe (applyDelta :172-188).
- Foreign sessions listed unconditionally; no lock/pid check. Liveness = mtime within 10 min + size growth (FollowedSessionRegistry followed-session-registry.ts:25-87, poll 2000ms, idle drop 10 min, user_takeover stops follow).

## 2. Tailing
- ADR adr-20260607-pty-transcript-pure-poll: pure polling, no fs.watch (kqueue coalesces + silently stalls), no chokidar.
- PTY own-session tail: tui-source.adapter.ts:106-142 — setInterval 50ms, stat size, read size-position bytes, buffer.split("\n") keep partial tail. Shrink: never re-read (position not reset). try/catch "next tick recovers".
- Session file discovery races the CLI: polls ~/.claude/sessions/<pid>.json for the UUID, 20s timeout, fallback newest jsonl with mtime >= spawn floor.
- Followed/imported tail: only size comparison, full re-read + re-parse each growth tick (2s). Partial trailing line dropped that tick.
- Transport: WebSocket only (Bun.serve websocket). Subscribe {topic:{type:"chat",chatId}}. Snapshot then chat.ops deltas (entries.append | runtime.set | sections.set | pending.set, src/shared/chat-ops.ts:17-21). Server ring buffer 512 ops (chat-op-log.ts); gap → full snapshot. 16ms broadcast debounce.
- Reconnect: KannaSocket src/client/app/socket.ts — backoff 750ms→5s, heartbeat 15s, resubscribe all topics → full resync. Client seq-gap → resubscribe.

## 3. Parsing
- Two parsers → one TranscriptEntry (26-variant union, src/shared/transcript-types.ts:312-338).
- Import mapper claude-session-mapper.ts:108-119: only user/assistant; tool_result, text, tool_use. Skips summary/system/custom-title. No thinking.
- Live normalizer claude-message-normalizer.ts:187-474: system/init, assistant, user, result (cancelled→interrupted), system/status, task_notification, background_tasks_changed, turn_duration (synth result), compact_boundary, context_cleared, "This session is being continued" → compact_summary. Blocks: thinking (non-empty), text, tool_use (name+id), tool_result (tool_use_id). No image blocks.
- tool_use↔tool_result pairing CLIENT-side: parseTranscript.ts:115-364 pendingToolCalls map by toolId; unmatched result silently dropped.
- parentUuid read nowhere; linear file order. isSidechain lines DROPPED from main stream (jsonl-to-event.ts:163,226,445). Agent files parsed by parseAgentTranscriptLines (agent-transcript-parse.ts) which bypasses the sidechain filter.
- Subagents: <project>/<session>/subagents/agent-<agentId>.jsonl, fetched by KNOWN agentId (from toolUseResult sidecar on the Task tool_result record), on demand, no cache, no tail, no glob, no .meta.json. WS subagents.getRun {chatId, agentId}.
- Unknown lines: fail-open; parse errors skipped; unknown types → [] silently; client renders kind:"unknown" as RawJsonMessage.

## 4. Rendering
- LegendList virtualization (@legendapp/list), estimatedItemSize 96, maintainScrollAtEnd threshold 0.1, last 12 rows always mounted. isAtEnd distance<=4; "scroll to bottom" button after 150ms debounce.
- Per-kind components; ≥2 consecutive collapsible tool calls grouped into CollapsedToolGroup, collapsed by default.
- Markdown: Lexical headless (renderMessage.tsx). Mermaid 11 lazy. Shiki (transitive via @pierre/diffs) lazy, 200KB ceiling.
- Subagents inline under parent row, indented depth*24px; native Task expands to fetch transcript inline.
- Session tabs: per-tab useKannaState(chatId), chatStateStore.chats record, ChatTabRoot. releaseChat never called (leak on tab close).
- "Standalone HTML export" README claim is FALSE in code; what exists is token-gated server share link (/api/share/<token>, ShareViewPage non-virtualized).

## 5. Shape
- Bun.serve server (port 3210, 127.0.0.1, EADDRINUSE retry ×20), hand-rolled http dispatcher; React 19 + Vite 6 + Zustand + react-router; single package, server runs raw TS, client built to dist/client. 79 *.adapter.ts files = IO seal.
- Sizes: useKannaState 1448, useAppGlobalState 1472, KannaTranscript.tsx 1053, server.ts 775, ChatTranscriptViewport 690, socket.ts 480, normalizer 474, jsonl-to-event 469.
