// client/src/http.ts — the ONE fail-closed HTTP boundary every client fetch passes through (spec
// §12.5, §13; fail-closed-edges.md). A browser `fetch` resolves for ANY HTTP status, so a bare
// `(await res.json()) as T` lets a 500's error body through as if it were data and blows up later
// (`projects.map` on `{error}`). This boundary refuses that: it checks `res.ok`, discriminates the
// failure kinds (abort / network / non-2xx status / malformed body / wrong shape) into ONE typed
// error, and validates the body's shape before it reaches a caller.
//
// `pure-core.md`: the `fetch` call is the one side effect; the decision-making (status check, shape
// gate, failure discrimination) is otherwise pure and the caller supplies the shape validator.

/** The discriminated ways an HTTP read can fail. `status` carries the code so a caller can tell a
 * 404 (the card keeps its placeholder, §13) from a 503 (the slot cap, §8.4). */
export type HttpFailure =
  | { kind: 'abort' }                        // the caller aborted the request (not an error to show)
  | { kind: 'network'; detail: string }      // fetch itself rejected (dropped connection, DNS, …)
  | { kind: 'status'; status: number }       // a resolved non-2xx response
  | { kind: 'parse' }                        // the 2xx body was not valid JSON (narrow SyntaxError)
  | { kind: 'shape' };                       // the 2xx body parsed but is the wrong shape

export class HttpError extends Error {
  constructor(readonly failure: HttpFailure) {
    super(`http boundary: ${failure.kind}`);
    this.name = 'HttpError';
  }
}

/** True iff `err` is an abort — a `DOMException`/`Error` named `AbortError`, the shape both browsers
 * and happy-dom raise when an `AbortSignal` fires. */
function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

async function request(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (isAbort(err)) throw new HttpError({ kind: 'abort' });
    throw new HttpError({ kind: 'network', detail: err instanceof Error ? err.message : String(err) });
  }
  if (!res.ok) throw new HttpError({ kind: 'status', status: res.status });
  return res;
}

/** Read `url` as JSON, refusing anything that is not a 2xx response of the shape `isValid` accepts.
 * Rejects with a typed `HttpError`, never a bare throw or an untyped cast. */
export async function fetchJson<T>(url: string, isValid: (v: unknown) => v is T, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await request(url, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    if (err instanceof SyntaxError) throw new HttpError({ kind: 'parse' });
    if (isAbort(err)) throw new HttpError({ kind: 'abort' });
    throw err; // an unrecognised failure is not this boundary's to swallow (fail-closed-edges)
  }
  if (!isValid(body)) throw new HttpError({ kind: 'shape' });
  return body;
}

/** Read `url` as text (the one non-JSON route, `/api/spill`), refusing a non-2xx status. */
export async function fetchText(url: string, init?: { signal?: AbortSignal }): Promise<string> {
  const res = await request(url, init);
  return res.text();
}

/** The `/api/block` response shape — `{ block: … }` — shared by every expandable card. */
export function isBlockResponse(v: unknown): v is { block: unknown } {
  return typeof v === 'object' && v !== null && 'block' in v;
}
