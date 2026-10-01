// session.adapter.ts — the runner's ONLY import of `@anthropic-ai/claude-agent-sdk`
// (spec "SDK drift" risk note + the zero-LLM wall). An SDK upgrade touches this file and
// nothing else; every other module reaches a session through the `SessionIO` seam.
// Enforced by structure.test.ts (ESLint layer deferred until typescript-eslint supports TS >= 7.1 — plan Amendment A3).
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SessionMessage, SpawnSessionParams } from '../core/session.ts';
import type { ProbeSessionOptions } from '../core/model-probe.ts';

/** The real SDK spawn, wrapping `query()` — used by run.ts to build the production
 * `SessionIO`. Not exercised by unit tests (it would hit the real SDK); the option-building
 * and message-parsing logic it feeds (session.ts) is fully covered without it. */
export function sdkSpawnSession(params: SpawnSessionParams): AsyncIterable<SessionMessage> {
  return query({ prompt: params.prompt, options: params.options }) as unknown as AsyncIterable<SessionMessage>;
}

/** The model probe's real SDK spawn (`core/model-probe.ts`, card runner-model-support): the same
 * `query()` with the probe's own small option block. Exercised end to end by `run.ts probe-model`. */
export function sdkSpawnProbe(params: { prompt: string; options: ProbeSessionOptions }): AsyncIterable<SessionMessage> {
  return query({ prompt: params.prompt, options: params.options }) as unknown as AsyncIterable<SessionMessage>;
}
