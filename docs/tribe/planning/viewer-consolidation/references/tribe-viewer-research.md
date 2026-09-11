# Tribe campaign viewer — factual audit (research, 2026-09-11, opus)
V = plugins/tribe/scripts/viewer, R = plugins/tribe/scripts/runner

## 0. No `--live` flag exists. What the owner sees is the printed URL `/live?repo=<encoded-cwd>&slug=<slug>` (R/core/viewer-launch.ts:30-33, printed R/cli/main.ts:547).

## 1. Modes
- serve.ts flags: --tribe-root ($HOME/.tribe), --port (4321). Unvalidated (`--port abc` → NaN, random port; in-use port → Bun stack dump). 127.0.0.1 hard-coded.
- Routes: / (status page, 387KB for 17 campaigns), /healthz, /app.js, /app.css, /live (pure shell, always 200), /events (SSE; 404 if campaign unresolved), /api/processes, else 404.
- /events resolution chain (V/serve.ts:42-70): run.json → statePath (absolute, verbatim) → selectLiveCard (last running, else last in sequence) → sessionId → ~/.claude/projects/<sanitize(realpath(run.repo))>/<sessionId>.jsonl + <sessionId>/subagents/.
- Spec D2(b) readdir fallback across ~/.claude/projects/* NOT implemented.
- Runner: --viewer-port (validated), --no-viewer; probes /healthz (500ms, viewer==='tribe-live-viewer') → reuse, else spawn `bun serve.ts --port N` detached/unref, never killed. No --tribe-root passed.
- Answer: NO, a user cannot browse an arbitrary session. Blocked by (1) routes accept only repo+slug, (2) sessionId derived from campaign-state.json, (3) process list = one card's session only. ~/.tribe coupling is ONLY the 3 JSON reads yielding (sessionId, cwd, cardId, cardStatus).

## 2. Pipeline
- Tail (adapters/transcript.adapter.ts + core/live/tail.ts): raw bytes [offset,size), streaming TextDecoder, carry partial line, offset = consumed bytes. `reset` returned by advanceTail but DISCARDED by poller; normalize state never reset; carry unbounded.
- records.ts parses type/uuid/parentUuid/sessionId/timestamp/cwd/message/toolUseResult/isSidechain/agentId; only assistant|user|system kept.
- normalize.ts: system ALWAYS dropped; user string content → user_prompt; user ARRAY text blocks DROPPED; tool_result → patch on pending tool_call; assistant text/thinking/tool_use; other blocks dropped. isSidechain/agentId/parentUuid/toolUseResult never read. EventKind tool_result/error/result never emitted.
- Real transcript top-level types seen: attachment 731, assistant 470, user 262, permission-mode 95, mode 95, atis-latch 95, last-prompt 92, queue-operation 76, custom-title 52, agent-name 52, system 51, ai-title 42, file-history-delta 11, pr-link 8, file-history-snapshot 8, cost-state 1.
- markdown.ts: escape-then-markup, fences segmented, subset markdown, href gated. No injection hole found. Strongest file.
- Process tree: readdir subagents/, agent-<id>.jsonl + .meta.json {agentType, description, toolUseId, parentAgentId, spawnDepth, requestShape, requestNonInteractive, model}. Status missing/done/active(10s)/idle.
- SSE: no id:/retry: → no resume; first tick snapshot (last 400 events, patches DISCARDED); append every 400ms; processes on change; ping 15s; error frames leak absolute paths. idleTimeout 60, cap 8.
- Client app.js: innerHTML replace on snapshot; append + patches by data-seq; processes list full re-render; error no-op; selectProcess doesn't update URL.

## 3. Tests: viewer 159 pass/1 skip; runner 645 pass. All bugs below are green under 804 tests.

## Findings
B1 Blocker — snapshot drops all tool RESULTS already on disk (patches discarded). 40 tool_calls/0 results measured.
B2 Blocker — array-form user messages dropped = every runner prompt/Executor Brief invisible. user_prompt:0 on live campaign.
B3 Blocker — campaign-state.json sessionId + run.json statePath are uncontained paths; proved reading /tmp secret via ../. fail-closed-edges obligation 4.
B4 Should — /events frozen on the card selected at connect; never follows next card. (Mechanism behind "only works when runner triggers it".)
B5 Should — /live returns 200 blank shell for unresolved campaign; /events 404 → EventSource permanent fail, error listener no-op. First ~30s of every run.
B6 Should — bad process id → error frame every 400ms, no backoff/cap, leaks paths.
B7 Should — never auto-scrolls; transcript section is not a scroll container; pinToBottom no-op; eviction shifts content.
B8 Should — named SSE event 'error' collides with EventSource transport error.
B9 Should — empty thinking blocks (runner Opus sessions have thinking:"" + signature) render as empty cards. 15/15.
B10 Should — system rows dropped (payload is `content` not `message`); spec says render.
B11 Should — tool input/results unbounded inline JSON in <code> inside <p>; 7KB single event; multi-MB data: line possible.
B12 Should — truncation/rotation → whole file re-emitted as duplicates.
B13 Should — per-connection maps (seqToToolUseId, resolvedToolUseIds, pending, carry) grow forever.
B14 Should — serve.ts arg handling fails open (NaN port, stack dump on EADDRINUSE).
B15 Should — every /events and /api/processes re-reads+renders whole transcript synchronously in setInterval.
B16 Should — no Host/Origin check; DNS rebinding can stream transcripts.
B17 Opt — detached viewers accumulate (2 stale pids observed), no idle exit.
B18 Opt — D2(b) unimplemented; moved repo → 404 no diagnostic.
B19 Opt — ISO timestamps compared as strings.
B20 Opt — dead EventKind values.
B21 Opt — selectProcess doesn't update URL.
B22 Opt — process list innerHTML rebuilt several times/sec (mtime churn).
B23 Opt — finished campaign shows idle not done (state file stale, no cross-check with run.json endedAt).
B24 Opt — encodeSseFrame newline strip dead; U+2028/9 unhandled.
B25 Opt — status page unbounded (387KB).

## 4. Size: viewer 6076 lines total; production ~2602; live-view-only ~1680; status-page-only 773. Zero runtime deps. Runner viewer coupling ~360 lines.
