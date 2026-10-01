# Executor fixtures — provenance

`fixtures-mirror-reality` (plugins/tribe/rules): these are real bytes, not convenient shapes.

| File | Provenance |
| --- | --- |
| `session-double.sh` | The executor session double (card runner-driver-only, spec §4.12). `DOUBLE_MODE=result-line` prints `$DOUBLE_RESULT_FILE`, which `adapters/executor-double.adapter.ts`'s `doubleResultMessage` passes through as the session's `result` message. |
| `result-claude-code-version-too-old.json` | Byte-for-byte copy of the first `result` line of a REAL session log: campaign `llm-wiki` (repo hieplam/Cabal), run `2026-10-01T14-36-20-603Z-059b`, log `llm-wiki-57723619-59b1-43ed-8ad5-53681be24a69.log`, SDK 0.3.278 (bundled Claude Code 2.1.278), model `claude-opus-5-5`. `subtype: "success"`, `is_error: true`, `api_error_status: 400`, `api_error_code: "claude_code_version_too_old"`. sha256 `1ba5eda29693975fc7f39c0dda4031d962d5ddf750e87c760e4e8dfd8b70b490`. |
| `result-model-not-found-404.json` | The `result` line of a REAL session started 2026-10-01 through the SDK's `query()` (SDK 0.3.286) with the nonexistent model `claude-nonexistent-9`: `is_error: true`, `api_error_status: 404`, and NO `api_error_code` field. sha256 `84c7d4282f112d037a2d27fafcedac2c1fa11798552abf5c062e379725137a19`. |
