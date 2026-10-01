// core/model-probe.ts — "can the runner's own SDK run this model?" (card runner-model-support,
// ruling D2). The smallest real session the runner can make: one turn, no tools, no settings, a
// one-line prompt — so it costs about a cent and answers in seconds. `doctor.sh --model <id>` runs
// it through `run.ts probe-model`; the campaign runner itself never does (dry-run stays zero-LLM).
//
// PURE except the injected spawn and the global timer (the same exception `session.ts` takes):
// the composition root (`cli/main.ts`) wires the real SDK or the executor double in.
import type { SessionMessage } from '../ports/ports.ts';

export const PROBE_PROMPT = 'Reply with the single word OK.';
export const DEFAULT_PROBE_TIMEOUT_MS = 120_000;

/** The probe's own option block — deliberately NOT the executor's pinned one (`session.ts`): no
 * tools, no settings tiers, no hooks, one turn. Model support is decided by the bundled Claude
 * Code version and the model id, and neither depends on those options. */
export interface ProbeSessionOptions {
  model: string;
  cwd: string;
  maxTurns: 1;
  settingSources: [];
  systemPrompt: string;
  tools: [];
  executable: 'bun';
  abortController: AbortController;
}

export type ProbeSpawn = (params: { prompt: string; options: ProbeSessionOptions }) => AsyncIterable<SessionMessage>;

export type ProbeVerdict =
  | { ok: true; model: string; claudeCodeVersion: string | null }
  | {
      ok: false;
      model: string;
      claudeCodeVersion: string | null;
      /** The API's own words when a result arrived, else what went wrong before one did. */
      reason: string;
      apiErrorStatus: number | null;
      apiErrorCode: string | null;
    };

export function buildProbeOptions(model: string, cwd: string, abortController: AbortController): ProbeSessionOptions {
  return {
    model, cwd, maxTurns: 1, settingSources: [], systemPrompt: PROBE_PROMPT, tools: [],
    executable: 'bun', abortController,
  };
}

/** The verdict from what the session produced. `result` is the first `result` message (or null
 * when none arrived); `failure` says why none did. A result is a pass only when it is a success
 * that is not an error — the 2026-10-01 refusal arrived as subtype `success` with `is_error: true`. */
export function classifyProbe(
  model: string, init: SessionMessage | null, result: SessionMessage | null, failure: string | null,
): ProbeVerdict {
  const version = init !== null && typeof init['claude_code_version'] === 'string' ? init['claude_code_version'] : null;
  if (result !== null && result.subtype === 'success' && result['is_error'] !== true) {
    return { ok: true, model, claudeCodeVersion: version };
  }
  if (result === null) {
    return {
      ok: false, model, claudeCodeVersion: version, apiErrorStatus: null, apiErrorCode: null,
      reason: failure ?? 'the session ended without a result message',
    };
  }
  const status = result['api_error_status'];
  const code = result['api_error_code'];
  const text = typeof result.result === 'string' && result.result !== '' ? result.result : `session ended with subtype "${String(result.subtype)}"`;
  return {
    ok: false, model, claudeCodeVersion: version, reason: text,
    apiErrorStatus: typeof status === 'number' ? status : null,
    apiErrorCode: typeof code === 'string' ? code : null,
  };
}

/** What the owner does about a refusal — one line, chosen from the typed facts only. */
export function remedyFor(verdict: Extract<ProbeVerdict, { ok: false }>): string {
  if (verdict.apiErrorCode === 'claude_code_version_too_old') {
    return 'bump @anthropic-ai/claude-agent-sdk in plugins/tribe/scripts/runner/package.json to the latest '
      + '(npm view @anthropic-ai/claude-agent-sdk@latest version), then run bun install in that directory';
  }
  if (verdict.apiErrorStatus === 404) {
    return `check the model id "${verdict.model}" — the API does not know it, or this login cannot use it`;
  }
  if (verdict.apiErrorStatus === null && verdict.apiErrorCode === null) {
    return `re-run when the network and the Claude Code login work: bun plugins/tribe/scripts/runner/run.ts probe-model --model ${verdict.model}`;
  }
  return `the API refused model "${verdict.model}" — read the reason above before starting a campaign on it`;
}

/** The probe's stdout: `ok: …` on a pass; `refused: …` then `fix: …` on a refusal. `doctor.sh`
 * relays these lines as they are. */
export function renderProbeLines(verdict: ProbeVerdict): string[] {
  const version = verdict.claudeCodeVersion === null ? '' : ` (Claude Code ${verdict.claudeCodeVersion})`;
  if (verdict.ok) return [`ok: model ${verdict.model} runs on the runner's SDK${version}`];
  const facts = [
    verdict.apiErrorStatus === null ? null : `HTTP ${verdict.apiErrorStatus}`,
    verdict.apiErrorCode === null ? null : `api_error_code ${verdict.apiErrorCode}`,
  ].filter((f): f is string => f !== null);
  const suffix = facts.length === 0 ? '' : ` [${facts.join(', ')}]`;
  return [
    `refused: model ${verdict.model} cannot run on the runner's SDK${version} — ${verdict.reason}${suffix}`,
    `fix: ${remedyFor(verdict)}`,
  ];
}

/** Runs the probe: stops at the FIRST result message (the SDK throws once an error result has been
 * delivered, so reading on would turn a clean verdict into a crash) and never waits past
 * `timeoutMs` (fail-closed-edges obligation 3). Never throws. */
export async function runModelProbe(model: string, cwd: string, spawn: ProbeSpawn, timeoutMs: number): Promise<ProbeVerdict> {
  const abortController = new AbortController();
  let init: SessionMessage | null = null;
  const consume = async (): Promise<ProbeVerdict> => {
    try {
      for await (const message of spawn({ prompt: PROBE_PROMPT, options: buildProbeOptions(model, cwd, abortController) })) {
        if (message.type === 'system' && message.subtype === 'init') init = message;
        if (message.type === 'result') return classifyProbe(model, init, message, null);
      }
      return classifyProbe(model, init, null, null);
    } catch (err) {
      return classifyProbe(model, init, null, `the session failed before a result: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProbeVerdict>((resolve) => {
    timer = setTimeout(() => {
      abortController.abort();
      resolve(classifyProbe(model, init, null, `no result within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([consume(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `probe-model` argv (after the subcommand word): `--model <id>` (required) and
 * `--timeout-seconds <10..600>` (default 120). A flag missing its value never swallows the next
 * flag as one (fail-closed-edges obligation 1). */
export function parseProbeArgs(argv: string[]): { model: string; timeoutMs: number } | { error: string } {
  let model: string | null = null;
  let timeoutMs = DEFAULT_PROBE_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    if (flag !== '--model' && flag !== '--timeout-seconds') return { error: `unknown argument: ${flag}` };
    if (value === undefined || value === '' || value.startsWith('--')) return { error: `${flag} needs a value` };
    if (flag === '--model') { model = value; continue; }
    if (!/^\d+$/.test(value) || Number(value) < 10 || Number(value) > 600) {
      return { error: `--timeout-seconds must be a whole number from 10 to 600, got "${value}"` };
    }
    timeoutMs = Number(value) * 1000;
  }
  if (model === null) return { error: '--model is required (e.g. --model claude-opus-5-5)' };
  return { model, timeoutMs };
}
