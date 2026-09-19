// adapters/viewer-launch.adapter.ts — the only file naming `node:child_process` for the
// live-viewer auto-start (Task 13, spec D11/D12). Owns the two world-touching facts
// `core/viewer-launch.ts` needs (whether `serve.ts` exists, whether a viewer already answers
// `/healthz`) and the one world-touching action its decision can produce (a detached spawn).
// `core/viewer-launch.ts` itself is never called with real I/O baked in — every fact arrives
// as a plain input, exactly like every other adapter in this package (purity wall,
// structure.test.ts).
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { decideViewerLaunch, type ViewerLaunchDecision } from '../core/viewer-launch.ts';
import type { ProbeSignal, ViewerPort } from '../ports/ports.ts';

/** The viewer's entry point, resolved from THIS adapter's own `import.meta.dir` as a
 * plugin-internal sibling — never an environment value, so the stateless-capability wall is
 * untouched (spec §6). `plugins/tribe/scripts/runner/adapters/` -> `../../viewer/serve.ts` ->
 * `plugins/tribe/scripts/viewer/serve.ts`. */
export const VIEWER_ENTRY_PATH = join(import.meta.dir, '../../viewer/serve.ts');

const PROBE_TIMEOUT_MS = 500;

/** Production `ViewerPort`: a plain read-only `fetch` probe (card D6) and a detached spawn
 * that cannot hold the runner open (D12: `detached: true`, `stdio: 'ignore'`, then
 * `unref()`). Task 27 (spec §10.4, R4 ruling): this adapter ONLY gathers the fact — WHAT the
 * `/healthz` fetch observed, reported as a typed `ProbeSignal` — and never decides
 * reuse/spawn/stale itself (`pure-core.md`: `core/viewer-launch.ts#decideViewerLaunch` is the
 * only place that inspects the body's `viewer`/`v` fields against the v2 floor). A connection
 * failure/timeout narrowly catches to `no-response` (fail-closed-edges.md: never thrown); a
 * 2xx-or-not body that fails to parse as a JSON object narrowly catches to `unparseable`;
 * anything else that actually answered is `responded` with its parsed body, unclassified. */
export function buildViewerPort(): ViewerPort {
  return {
    async probeViewer(port, host = '127.0.0.1'): Promise<ProbeSignal> {
      let res: Response;
      try {
        res = await fetch(`http://${host}:${port}/healthz`, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
      } catch {
        return { kind: 'no-response' };
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { kind: 'unparseable' };
      }
      if (typeof body !== 'object' || body === null) {
        return { kind: 'unparseable' };
      }
      return { kind: 'responded', body: body as Record<string, unknown> };
    },
    spawnDetached(argv) {
      const child = spawn(argv[0] as string, argv.slice(1), {
        detached: true,
        stdio: 'ignore',
      });
      // F38/F49: an unlistened spawn 'error' (e.g. ENOENT — `bun` not resolvable on the
      // child's PATH under cron/launchd/CI, EACCES, fd exhaustion) fires asynchronously and
      // is an uncaught exception that kills the whole campaign runner — the enclosing
      // try/catch in `cli/main.ts` has already exited its scope by the time it fires, so it
      // cannot help. Same convention as `run-io.adapter.ts`'s `realExec`: degrade, never
      // throw — a failed spawn must never gate the run (D12: "observability exhaust never
      // kills a run"). Unlike F38's original fix, the event is now REPORTED on stderr rather
      // than swallowed (F49: the docs promise a stderr line for this case, and this is the
      // only failure shape the adapter can actually observe — `spawnDetached` returns void
      // by design, so `console.error` here is the sole channel; the caller has already
      // returned the 'spawn' decision and printed its URL on stdout).
      child.on('error', (err) => {
        console.error(
          `campaign viewer: failed to start (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      child.unref();
    },
  };
}

/** The edge `cli/main.ts` calls: gathers the two facts `decideViewerLaunch` needs, hands
 * them to the pure core, and performs the spawn if (and only if) the decision says `spawn`.
 * Under `dryRun`/`disabled`/a missing entry file, the probe is never issued — no network call
 * happens at all, matching spec D11's "`--dry-run` never reaches this code path" (zero side
 * effects stays a hard contract). `port`/`entryPath` are injectable for tests; production
 * callers (`cli/main.ts`) use the defaults. */
export async function launchViewer(
  input: { dryRun: boolean; disabled: boolean; port: number; homeDir: string },
  viewerPort: ViewerPort = buildViewerPort(),
  entryPath: string = VIEWER_ENTRY_PATH,
): Promise<ViewerLaunchDecision> {
  const entryExists = existsSync(entryPath);
  const skipProbe = input.dryRun || input.disabled || !entryExists;
  // Skipping degrades to the same signal as "nothing listening" — `decideViewerLaunch` never
  // reaches the classification at all on these paths (dry-run/disabled/missing-entry all
  // short-circuit to `skip` first), so the exact signal here is inert, just well-typed.
  const probe: ProbeSignal = skipProbe ? { kind: 'no-response' } : await viewerPort.probeViewer(input.port);

  const decision = decideViewerLaunch({
    dryRun: input.dryRun,
    disabled: input.disabled,
    port: input.port,
    homeDir: input.homeDir,
    entryPath,
    entryExists,
    probe,
  });

  if (decision.kind === 'spawn') {
    viewerPort.spawnDetached(decision.argv as string[]);
  }

  return decision;
}
