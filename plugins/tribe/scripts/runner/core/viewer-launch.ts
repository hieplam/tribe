// core/viewer-launch.ts — pure launch decision for the runner's read-only live viewer
// (spec D11/D12, plan Task 13; Task 27 rewrites the URLs and the probe classification per
// spec §10.2/§10.4). No fs, no clock, no spawn, no network: every world-touching fact
// (whether the entry file exists, what the adapter's `/healthz` probe observed) arrives as an
// input; the adapter (`adapters/viewer-launch.adapter.ts`) is the only thing that gathers
// those facts and acts on the decision this module returns.
//
// Card D5 (no new persisted format): the campaign key and URL are derived from `--home`
// ALONE — nothing is read from or written to `run.json`/`campaign-state.json`.
import { basename, dirname } from 'node:path';
import type { ProbeSignal } from '../ports/ports.ts';

/** `--home` is `~/.tribe/<repoKey>/campaigns/<slug>/` — `repoKey` and `slug` are read
 * straight off that path, never persisted anywhere (card D5). */
export interface CampaignKey {
  repoKey: string;
  slug: string;
}

export function campaignKeyOf(homeDir: string): CampaignKey {
  const repoKey = basename(dirname(dirname(homeDir)));
  const slug = basename(homeDir);
  return { repoKey, slug };
}

/** The runner's own root stdout line (spec §10.2 line 1, §9). A campaign is identified by the
 * PAIR `(repoKey, slug)`, never by the slug alone — two different repo keys on this machine
 * can and do share a slug — so both halves are carried, each independently
 * `encodeURIComponent`'d (an unencoded `&`, space, or unicode character in either would
 * otherwise either split into extra query params or reach the owner's terminal/browser
 * un-escaped) with the `/` between them left LITERAL, so `?campaign=<repoKey>/<slug>` reads as
 * one query value whose own separator survives percent-decoding on the client. */
export function viewerRootUrl(port: number, repoKey: string, slug: string): string {
  return `http://127.0.0.1:${port}/?campaign=${encodeURIComponent(repoKey)}/${encodeURIComponent(slug)}`;
}

/** The per-card session line (spec §10.2 line 2) — the root URL's own origin plus `/s/<id>`.
 * Pure string math (parses `baseUrl` only to recover its origin; no fetch, no fs). */
export function sessionUrlFor(baseUrl: string, sessionId: string): string {
  return `${new URL(baseUrl).origin}/s/${sessionId}`;
}

export interface ViewerLaunchInput {
  /** `--dry-run`: the whole launch is zero side effects by construction (spec D11). */
  dryRun: boolean;
  /** `--no-viewer`. */
  disabled: boolean;
  port: number;
  homeDir: string;
  /** The viewer's `serve.ts`, resolved by the adapter from its own `import.meta.dir` as a
   * plugin-internal sibling (`../../viewer/serve.ts`) — never an environment value. */
  entryPath: string;
  entryExists: boolean;
  /** The adapter's `GET /healthz` probe result (spec §10.4, D12 — reuse first). Never
   * consulted when the launch already short-circuits to `skip` above. */
  probe: ProbeSignal;
}

export interface ViewerLaunchDecision {
  kind: 'skip' | 'reuse' | 'spawn' | 'stale';
  url: string | null;
  argv: string[] | null;
  note: string | null;
}

/** Spec §10.4's v2 floor: `viewer === 'tribe-viewer' && typeof v === 'number' && v >= 2` — a
 * FLOOR, not an equality, so a future v3 viewer stays reusable. Pure: inspects only the
 * already-parsed body fields the adapter handed over; never touches the network itself. */
function isCurrentViewer(body: Record<string, unknown>): boolean {
  return body.viewer === 'tribe-viewer' && typeof body.v === 'number' && body.v >= 2;
}

/** Spec §10.4's three probe outcomes, pure over the adapter's `ProbeSignal`:
 * - `no-response` (nothing listening) -> `spawn`, exactly as today;
 * - a well-formed v2 body -> `reuse`, exactly as today;
 * - everything else the port actually answered WITH — an old v1 body, an unrelated service's
 *   200, or a body that failed to parse as JSON at all (`unparseable`) -> `stale`. The port is
 *   occupied by something that is not this viewer: spawning would die to `EADDRINUSE`
 *   invisibly (the failure mode the old code could not see), and reusing would hand out a URL
 *   that 404s. Neither is safe, so neither happens. */
function classifyProbe(probe: ProbeSignal): 'reuse' | 'spawn' | 'stale' {
  if (probe.kind === 'no-response') return 'spawn';
  if (probe.kind === 'unparseable') return 'stale';
  return isCurrentViewer(probe.body) ? 'reuse' : 'stale';
}

/** Pure decision: dry-run and `--no-viewer` both degrade to `skip` before anything else is
 * even considered; a missing entry file also degrades to `skip` (never a thrown error);
 * otherwise the probe's classification (`classifyProbe` above) picks `reuse` (D12 — reuse
 * first), `spawn` (`bun <entryPath> --port <port>`, the adapter performs the actual detached
 * spawn — no `--tribe-root`: both roots resolve from `HOME` inside the viewer itself, §5/§12.3),
 * or `stale` (spec §10.4 outcome 3 — no URL, one stderr line naming the port). */
export function decideViewerLaunch(input: ViewerLaunchInput): ViewerLaunchDecision {
  if (input.dryRun) {
    return { kind: 'skip', url: null, argv: null, note: 'skipped: --dry-run' };
  }
  if (input.disabled) {
    return { kind: 'skip', url: null, argv: null, note: 'skipped: --no-viewer' };
  }
  if (!input.entryExists) {
    return {
      kind: 'skip',
      url: null,
      argv: null,
      note: `skipped: viewer entry not found at ${input.entryPath} (expected serve.ts)`,
    };
  }

  const { repoKey, slug } = campaignKeyOf(input.homeDir);
  const url = viewerRootUrl(input.port, repoKey, slug);
  const outcome = classifyProbe(input.probe);

  if (outcome === 'reuse') {
    return { kind: 'reuse', url, argv: null, note: null };
  }
  if (outcome === 'stale') {
    return {
      kind: 'stale',
      url: null,
      argv: null,
      note: `stale viewer on port ${input.port}, stop it or pass --viewer-port <n> (needs v2, got v1)`,
    };
  }
  return { kind: 'spawn', url, argv: ['bun', input.entryPath, '--port', String(input.port)], note: null };
}
