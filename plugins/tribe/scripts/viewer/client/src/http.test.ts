// client/src/http.test.ts — the ONE fail-closed HTTP boundary (spec §12.5, fail-closed-edges).
// Every client fetch passes through it: it checks res.ok, discriminates abort/network/parse/shape,
// and validates the body shape before it reaches a caller. The critical regression it guards: a
// non-2xx response with a JSON body must REJECT (typed), never resolve as data and blow up later.
import { describe, expect, test } from 'bun:test';
import { fetchJson, fetchText, HttpError } from './http.ts';

function withFetch(handler: (url: string) => Response | Promise<Response> | never, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}

const isObj = (v: unknown): v is { ok: boolean } => typeof v === 'object' && v !== null;

describe('fetchJson — the fail-closed HTTP boundary', () => {
  test('a RESOLVED non-2xx response REJECTS with a typed status failure, even with a JSON body', async () => {
    await withFetch(() => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }), async () => {
      let caught: unknown = null;
      try {
        await fetchJson('/api/x', isObj);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).failure).toEqual({ kind: 'status', status: 500 });
    });
  });

  test('a 2xx body of the wrong SHAPE rejects with a typed shape failure', async () => {
    await withFetch(() => new Response(JSON.stringify(42)), async () => {
      let caught: unknown = null;
      try {
        await fetchJson('/api/x', isObj);
      } catch (e) {
        caught = e;
      }
      expect((caught as HttpError).failure.kind).toBe('shape');
    });
  });

  test('malformed JSON rejects with a typed parse failure (narrow SyntaxError, never a raw throw)', async () => {
    await withFetch(() => new Response('{ not json'), async () => {
      let caught: unknown = null;
      try {
        await fetchJson('/api/x', isObj);
      } catch (e) {
        caught = e;
      }
      expect((caught as HttpError).failure.kind).toBe('parse');
    });
  });

  test('a valid 2xx body of the right shape resolves to the typed value', async () => {
    await withFetch(() => new Response(JSON.stringify({ ok: true })), async () => {
      const v = await fetchJson('/api/x', isObj);
      expect(v).toEqual({ ok: true });
    });
  });

  test('fetchText returns the body on 2xx and rejects with a typed status on a non-2xx', async () => {
    await withFetch(() => new Response('hello', { headers: { 'content-type': 'text/plain' } }), async () => {
      expect(await fetchText('/api/spill')).toBe('hello');
    });
    await withFetch(() => new Response('nope', { status: 404 }), async () => {
      let caught: unknown = null;
      try {
        await fetchText('/api/spill');
      } catch (e) {
        caught = e;
      }
      expect((caught as HttpError).failure).toEqual({ kind: 'status', status: 404 });
    });
  });
});
