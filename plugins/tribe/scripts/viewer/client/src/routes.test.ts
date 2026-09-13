// client/src/routes.test.ts — the four URL shapes of spec §3.2, parsed and round-tripped
// through `pushState` (plan Task 22, Step 1). Pure: `navigate` takes the `history` object as an
// injected argument (`pure-core.md`) rather than reaching for the global `window.history`, so
// this test needs no DOM/browser environment — a `pushState`-shaped fake is enough.
import { describe, expect, test } from 'bun:test';
import { navigate, parseClientPath, routeToPath, type ClientRoute } from './routes.ts';

/** The one method `navigate` calls, recorded rather than actually touching any real history. */
class FakeHistory {
  path = '/';
  pushState(_data: unknown, _unused: string, url?: string | URL | null): void {
    if (url !== undefined && url !== null) this.path = String(url);
  }
}

// spec §3.2's four client-routed shapes: `/`, `/p/<encodedProjectDir>`, `/s/<sessionId>`,
// `/s/<sessionId>/a/<agentId>`.
const SHAPES: ClientRoute[] = [
  { kind: 'list' },
  { kind: 'project', projectDir: '-Users-hip-repo-tribe' },
  { kind: 'session', sessionId: 'a1b2c3d4-0000-4000-8000-000000000000' },
  { kind: 'session_agent', sessionId: 'a1b2c3d4-0000-4000-8000-000000000000', agentId: 'agent-1' },
];

describe('client routes (spec §3.2)', () => {
  for (const route of SHAPES) {
    test(`${route.kind} round-trips through pushState`, () => {
      const history = new FakeHistory();
      navigate(history, route);
      expect(parseClientPath(history.path)).toEqual(route);
    });
  }

  test('routeToPath produces exactly the four path shapes spec §3.2 names', () => {
    expect(routeToPath({ kind: 'list' })).toBe('/');
    expect(routeToPath({ kind: 'project', projectDir: 'abc' })).toBe('/p/abc');
    expect(routeToPath({ kind: 'session', sessionId: 'abc-123' })).toBe('/s/abc-123');
    expect(routeToPath({ kind: 'session_agent', sessionId: 'abc-123', agentId: 'agent-1' })).toBe(
      '/s/abc-123/a/agent-1',
    );
  });

  test('a project dir with characters needing encoding still round-trips', () => {
    const route: ClientRoute = { kind: 'project', projectDir: '-Users-hip-repo tribe' };
    const history = new FakeHistory();
    navigate(history, route);
    expect(history.path).toBe('/p/-Users-hip-repo%20tribe');
    expect(parseClientPath(history.path)).toEqual(route);
  });

  test('an unrecognized path falls back to the list route (the shell owns everything else, §3.2)', () => {
    expect(parseClientPath('/nonsense')).toEqual({ kind: 'list' });
  });
});
