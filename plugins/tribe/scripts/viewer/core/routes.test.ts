// core/routes.test.ts — one case per row of spec §3.2's route table, plus the refusal matrix.
//
// Oracle: spec §3.2 (route table + closing rule) and §5.6/§9/§10.4 are the contract. Every
// refusal below asserts a TYPED route (`bad_request` with a reason, or `not_found`) — never a
// thrown exception (`fail-closed-edges` obligation 1).
import { describe, expect, test } from 'bun:test';
import { parseRoute } from './routes.ts';

const ORIGIN = 'http://127.0.0.1:4321';
const VALID_SESSION = 'a0000000-0000-4000-8000-000000000001'; // matches ^[0-9a-fA-F-]{8,64}$
const VALID_AGENT = 'root01';
const VALID_PROJECT = '-Users-fixture-repo-alpha';

function route(path: string) {
  return parseRoute(new URL(path, ORIGIN).toString());
}

describe('spec §3.2 route table', () => {
  test('GET / — the shell, no query', () => {
    expect(route('/')).toEqual({ kind: 'shell', campaign: null, all: false });
  });

  test('GET /?all=1 — the D10 "show older projects" flag (§5.6)', () => {
    expect(route('/?all=1')).toEqual({ kind: 'shell', campaign: null, all: true });
  });

  test('GET /?campaign=<repoKey>/<slug> — the pair pre-fills the filter (§9)', () => {
    expect(route('/?campaign=-Users-hip-repo-tribe/viewer-consolidation')).toEqual({
      kind: 'shell',
      campaign: { repoKey: '-Users-hip-repo-tribe', slug: 'viewer-consolidation' },
      all: false,
    });
  });

  test('GET /p/<encodedProjectDir> — the shell, unconditionally (client-routed)', () => {
    expect(route(`/p/${VALID_PROJECT}`)).toEqual({ kind: 'shell_project', projectDir: VALID_PROJECT });
  });

  test('GET /s/<sessionId> — the shell, unconditionally (client-routed)', () => {
    expect(route(`/s/${VALID_SESSION}`)).toEqual({ kind: 'shell_session', sessionId: VALID_SESSION });
  });

  test('GET /s/does-not-exist — STILL the shell: the split is by prefix, not by existence', () => {
    // §3.2: "So /s/does-not-exist returns the shell ... /api/session/<id> is what 404s."
    // The server never probes the filesystem to decide a status code at this route.
    expect(route('/s/does-not-exist')).toEqual({ kind: 'shell_session', sessionId: 'does-not-exist' });
  });

  test('GET /s/<sessionId>/a/<agentId> — one subagent tab', () => {
    expect(route(`/s/${VALID_SESSION}/a/${VALID_AGENT}`)).toEqual({
      kind: 'shell_session_agent',
      sessionId: VALID_SESSION,
      agentId: VALID_AGENT,
    });
  });

  test('GET /index.html — the same bytes as GET / (§16.5 hashes it against the built file)', () => {
    expect(route('/index.html')).toEqual({ kind: 'shell', campaign: null, all: false });
  });

  test('GET /assets/<name> — the built file', () => {
    expect(route('/assets/main-abc123.js')).toEqual({ kind: 'asset', name: 'main-abc123.js' });
  });

  test('GET /healthz — parses to the health route', () => {
    expect(route('/healthz')).toEqual({ kind: 'health' });
  });

  test('GET /api/projects — no query', () => {
    expect(route('/api/projects')).toEqual({ kind: 'api_projects', all: false });
  });

  test('GET /api/projects?all=1 — the D10 flag (§5.6)', () => {
    expect(route('/api/projects?all=1')).toEqual({ kind: 'api_projects', all: true });
  });

  test('GET /api/sessions?project=<dir>', () => {
    expect(route(`/api/sessions?project=${VALID_PROJECT}`)).toEqual({
      kind: 'api_sessions',
      project: VALID_PROJECT,
    });
  });

  test('GET /api/session/<sessionId>', () => {
    expect(route(`/api/session/${VALID_SESSION}`)).toEqual({
      kind: 'api_session',
      sessionId: VALID_SESSION,
    });
  });

  test('GET /api/rows?session=&agent=&before=&limit=&orphans= — every parameter present', () => {
    expect(
      route(`/api/rows?session=${VALID_SESSION}&agent=${VALID_AGENT}&before=1024&limit=750&orphans=toolu_a,toolu_b`),
    ).toEqual({
      kind: 'api_rows',
      sessionId: VALID_SESSION,
      agentId: VALID_AGENT,
      before: 1024,
      limit: 750,
      orphans: ['toolu_a', 'toolu_b'],
    });
  });

  test('GET /api/rows?session=<id> — omitted params default: before=null, agent=null, orphans=[], limit=500', () => {
    expect(route(`/api/rows?session=${VALID_SESSION}`)).toEqual({
      kind: 'api_rows',
      sessionId: VALID_SESSION,
      agentId: null,
      before: null,
      limit: 500,
      orphans: [],
    });
  });

  test('GET /api/rows?session=<id>&limit=999999 — clamped to 2000, not refused (§3.2)', () => {
    const parsed = route(`/api/rows?session=${VALID_SESSION}&limit=999999`);
    expect(parsed).toMatchObject({ kind: 'api_rows', limit: 2000 });
  });

  test('GET /api/block?session=&agent=&at=&i=', () => {
    expect(route(`/api/block?session=${VALID_SESSION}&agent=${VALID_AGENT}&at=128&i=2`)).toEqual({
      kind: 'api_block',
      sessionId: VALID_SESSION,
      agentId: VALID_AGENT,
      at: 128,
      i: 2,
    });
  });

  test('GET /api/spill?session=&name=', () => {
    expect(route(`/api/spill?session=${VALID_SESSION}&name=fixturespill01.txt`)).toEqual({
      kind: 'api_spill',
      sessionId: VALID_SESSION,
      agentId: null,
      name: 'fixturespill01.txt',
    });
  });

  test('GET /events?session=&agent=', () => {
    expect(route(`/events?session=${VALID_SESSION}&agent=${VALID_AGENT}`)).toEqual({
      kind: 'events',
      sessionId: VALID_SESSION,
      agentId: VALID_AGENT,
    });
  });
});

describe('the one rule for a path not in the table (§3.2 closing rule)', () => {
  test('an unknown top-level path — JSON 404, never the shell', () => {
    expect(route('/nonsense')).toEqual({ kind: 'not_found', path: '/nonsense' });
  });

  test('an unknown /api path — typed not_found, never a throw', () => {
    expect(route('/api/nonsense')).toEqual({ kind: 'not_found', path: '/api/nonsense' });
  });
});

describe('the refusal matrix — every case returns a typed route, never a throw', () => {
  test('session id containing ".." as a path segment — never resolves to a session route', () => {
    // WHATWG `new URL(...)` collapses `..` path segments BEFORE this parser ever sees the
    // pathname (`/api/session/..` -> pathname `/api/`), so the traversal string never reaches
    // an id here at all: it becomes an unmatched path (`not_found`), which is itself the
    // refusal — never `bad_request` because there is no session-id branch left to reject it,
    // and never a throw. Either typed refusal would satisfy the oracle; assert what actually
    // happens so a future change to this fact is visible.
    const result = route('/api/session/..');
    expect(result).toEqual({ kind: 'not_found', path: '/api/' });
  });

  test('session id with an embedded ".." segment — bad_request', () => {
    const result = route(`/api/rows?session=${encodeURIComponent('../../etc/passwd')}`);
    expect(result.kind).toBe('bad_request');
  });

  test('percent-encoded slash in a session id — bad_request', () => {
    // "a%2Fb" decodes (once) to "a/b" — a path separator smuggled through the id.
    const raw = new URL(`${ORIGIN}/api/session/a%2Fb`);
    expect(parseRoute(raw.toString()).kind).toBe('bad_request');
  });

  test('double-encoded ".." ("..%2f" literally, undecoded by a naive single-decode) — bad_request', () => {
    const raw = `${ORIGIN}/api/rows?session=..%252f..%252fetc%252fpasswd`;
    expect(parseRoute(raw).kind).toBe('bad_request');
  });

  test('a NUL byte in a session id — bad_request', () => {
    const raw = `${ORIGIN}/api/session/${encodeURIComponent('abc\x00def')}`;
    expect(parseRoute(raw).kind).toBe('bad_request');
  });

  test('an empty session id (trailing slash, nothing after) — not_found (no id segment at all)', () => {
    // `/api/session/` has an empty final segment: no id was supplied, so this is a routing miss,
    // not a validation failure of a supplied value.
    expect(route('/api/session/').kind).toBe('not_found');
  });

  test('an empty session id supplied via query — bad_request (a value WAS supplied, and it is empty)', () => {
    expect(route('/api/rows?session=').kind).toBe('bad_request');
  });

  test('a 500-character session id — bad_request (exceeds the 64-char bound, §5.2)', () => {
    const huge = 'a'.repeat(500);
    expect(route(`/api/session/${huge}`).kind).toBe('bad_request');
  });

  test('an unknown /api path — not_found, never a throw', () => {
    expect(route('/api/totally-unknown').kind).toBe('not_found');
  });

  test('an unknown asset name shaped as traversal — bad_request, never a throw', () => {
    const raw = `${ORIGIN}/assets/${encodeURIComponent('../../etc/passwd')}`;
    expect(parseRoute(raw).kind).toBe('bad_request');
  });

  test('a bare campaign slug with no "/" is REJECTED (§9 — the pair, never the slug alone)', () => {
    // Two real repo keys on this machine share slugs today (measured, §9) — a slug-only filter
    // would silently merge two unrelated campaigns.
    expect(route('/?campaign=viewer-consolidation').kind).toBe('bad_request');
  });

  test('a bare campaign slug with no "/" on /api/projects is also REJECTED', () => {
    expect(route('/api/projects?campaign=viewer-consolidation').kind).toBe('bad_request');
  });

  // The session/agent validation block is shared by /api/rows, /api/block, /api/spill, and
  // /events (dedup, phase-0 fix). /api/rows and /api/block already exercise an invalid session
  // above; these four cases guard the two sites (and the invalid-agent branch) that were not yet
  // asserted — since all four call the SAME extracted gate, this now guards every call site.
  test('GET /events?session=<invalid> — bad_request, same gate as /api/rows and /api/block', () => {
    expect(route('/events?session=not-a-valid-id').kind).toBe('bad_request');
  });

  test('GET /events?session=<valid>&agent=<invalid> — bad_request', () => {
    expect(route(`/events?session=${VALID_SESSION}&agent=..%2f..%2fetc`).kind).toBe('bad_request');
  });

  test('GET /api/spill?session=<invalid>&name=<valid> — bad_request', () => {
    expect(route('/api/spill?session=not-a-valid-id&name=fixturespill01.txt').kind).toBe('bad_request');
  });

  test('GET /api/spill?session=<valid>&agent=<invalid>&name=<valid> — bad_request', () => {
    expect(
      route(`/api/spill?session=${VALID_SESSION}&agent=..%2f..%2fetc&name=fixturespill01.txt`).kind,
    ).toBe('bad_request');
  });
});

describe('never a throw', () => {
  test('parseRoute never throws, across the whole refusal matrix', () => {
    const hostileInputs = [
      '/api/session/..',
      '/api/session/a%2Fb',
      `/api/rows?session=${encodeURIComponent('abc\x00def')}`,
      '/assets/..%2f..%2fetc%2fpasswd',
      '/api/rows?session=' + 'a'.repeat(5000),
      '/%00',
      '/api/block?session=x&agent=y&at=abc&i=def',
    ];
    for (const path of hostileInputs) {
      expect(() => parseRoute(new URL(path, ORIGIN).toString())).not.toThrow();
    }
  });
});
