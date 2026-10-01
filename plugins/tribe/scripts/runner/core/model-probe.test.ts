import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionMessage } from '../ports/ports.ts';
import {
  buildProbeOptions, classifyProbe, parseProbeArgs, PROBE_PROMPT, renderProbeLines, runModelProbe, type ProbeSpawn,
} from './model-probe.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'executor');
const line = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as SessionMessage;
const INIT: SessionMessage = { type: 'system', subtype: 'init', session_id: 's', claude_code_version: '2.1.278' };
const OK_RESULT: SessionMessage = { type: 'result', subtype: 'success', is_error: false, result: 'OK', session_id: 's' };

/** A spawn yielding `messages`, then throwing — the real SDK throws once an error result has been
 * delivered, so a probe that reads past the first result turns a verdict into a crash. */
const spawnOf = (messages: SessionMessage[], seen: Array<Parameters<ProbeSpawn>[0]> = []): ProbeSpawn => (params) => {
  seen.push(params);
  return (async function* () {
    for (const m of messages) yield m;
    throw new Error('Claude Code returned an error result');
  })();
};

describe('classifyProbe — against real captured result lines', () => {
  test('the 2026-10-01 refusal: not ok, the API reason, status 400 and the code', () => {
    expect(classifyProbe('claude-opus-5-5', INIT, line('result-claude-code-version-too-old.json'), null)).toEqual({
      ok: false, model: 'claude-opus-5-5', claudeCodeVersion: '2.1.278', apiErrorStatus: 400, apiErrorCode: 'claude_code_version_too_old',
      reason: "API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again.",
    });
  });
  test('an unknown model: not ok, HTTP 404, no code', () => {
    expect(classifyProbe('claude-nonexistent-9', INIT, line('result-model-not-found-404.json'), null))
      .toMatchObject({ ok: false, apiErrorStatus: 404, apiErrorCode: null });
  });
  test('a clean result is ok', () => {
    expect(classifyProbe('m', INIT, OK_RESULT, null)).toEqual({ ok: true, model: 'm', claudeCodeVersion: '2.1.278' });
  });
  test('no result at all is not ok, carrying the failure', () => {
    expect(classifyProbe('m', null, null, 'no result within 120 s')).toMatchObject({ ok: false, reason: 'no result within 120 s' });
  });
});

describe('renderProbeLines — what doctor.sh relays', () => {
  test('a refusal names the model, the API reason, the code, and the SDK fix', () => {
    const lines = renderProbeLines(classifyProbe('claude-opus-5-5', INIT, line('result-claude-code-version-too-old.json'), null));
    expect(lines[0]).toStartWith("refused: model claude-opus-5-5 cannot run on the runner's SDK (Claude Code 2.1.278) — API Error: 400");
    expect(lines[0]).toEndWith('[HTTP 400, api_error_code claude_code_version_too_old]');
    expect(lines[1]).toStartWith('fix: bump @anthropic-ai/claude-agent-sdk');
  });
  test('an unknown model is told to check the id', () => {
    const lines = renderProbeLines(classifyProbe('claude-nonexistent-9', INIT, line('result-model-not-found-404.json'), null));
    expect(lines[1]).toBe('fix: check the model id "claude-nonexistent-9" — the API does not know it, or this login cannot use it');
  });
  test('a pass is one ok line', () => {
    expect(renderProbeLines({ ok: true, model: 'm', claudeCodeVersion: '2.1.286' }))
      .toEqual(["ok: model m runs on the runner's SDK (Claude Code 2.1.286)"]);
  });
});

describe('runModelProbe', () => {
  test('stops at the first result: the SDK throwing afterwards never turns the verdict into a crash', async () => {
    const seen: Array<Parameters<ProbeSpawn>[0]> = [];
    const verdict = await runModelProbe('claude-opus-5-5', '/cwd', spawnOf([INIT, line('result-claude-code-version-too-old.json')], seen), 5_000);
    expect(verdict).toMatchObject({ ok: false, apiErrorCode: 'claude_code_version_too_old' });
    expect(seen[0]?.prompt).toBe(PROBE_PROMPT);
    expect(seen[0]?.options).toMatchObject({ model: 'claude-opus-5-5', cwd: '/cwd', maxTurns: 1, settingSources: [], tools: [] });
  });
  test('a spawn that throws before any result is a refusal, never a throw', async () => {
    const verdict = await runModelProbe('m', '/cwd', spawnOf([]), 5_000);
    expect(verdict).toMatchObject({ ok: false, reason: 'the session failed before a result: Claude Code returned an error result' });
  });
  test('a session that never answers is refused at the timeout, and aborted', async () => {
    let aborted = false;
    const hang: ProbeSpawn = (params) => (async function* () {
      params.options.abortController.signal.addEventListener('abort', () => { aborted = true; });
      yield INIT;
      await new Promise(() => {});
    })();
    const verdict = await runModelProbe('m', '/cwd', hang, 50);
    expect(verdict).toMatchObject({ ok: false, reason: 'no result within 0 s' });
    expect(aborted).toBe(true);
  });
  test('the option block is the small probe block, never the executor\'s', () => {
    const o = buildProbeOptions('m', '/cwd', new AbortController());
    expect(Object.keys(o).sort()).toEqual(['abortController', 'cwd', 'executable', 'maxTurns', 'model', 'settingSources', 'systemPrompt', 'tools']);
  });
});

describe('parseProbeArgs — fail closed', () => {
  test.each([
    [['--model', 'claude-opus-5-5'], { model: 'claude-opus-5-5', timeoutMs: 120_000 }],
    [['--model', 'm', '--timeout-seconds', '30'], { model: 'm', timeoutMs: 30_000 }],
    [[], { error: '--model is required (e.g. --model claude-opus-5-5)' }],
    [['--model'], { error: '--model needs a value' }],
    [['--model', '--timeout-seconds', '30'], { error: '--model needs a value' }],
    [['--timeout-seconds', '5', '--model', 'm'], { error: '--timeout-seconds must be a whole number from 10 to 600, got "5"' }],
    [['--fast'], { error: 'unknown argument: --fast' }],
  ])('%j', (argv, want) => {
    expect(parseProbeArgs(argv as string[])).toEqual(want);
  });
});
