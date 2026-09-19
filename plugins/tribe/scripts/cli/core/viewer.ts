// core/viewer.ts — how `tribe` gets the user a running viewer: reuse one already on the port,
// else start one, walking to the next port when the port is taken (kanna's behaviour).
// Every world-touching step (probe, spawn, browser, output) arrives through `ViewerIo`, so the
// whole decision flow runs in tests without a network or a process (pure-core.md).
import { classifyProbe } from '../../runner/core/viewer-launch.ts';
import type { ProbeSignal } from '../../runner/ports/ports.ts';

/** How many consecutive ports to try before giving up — kanna's MAX_PORT_ATTEMPTS. */
export const MAX_PORT_ATTEMPTS = 20;

/** serve.ts exits 1 for exactly one reason: its port is already bound (serve.ts `fail(1, ...)`). */
const VIEWER_EXIT_PORT_IN_USE = 1;

/** The first thing a started viewer does: answer /healthz, or exit before it ever could. */
export type StartResult = { kind: 'ready' } | { kind: 'exited'; code: number } | { kind: 'timeout' };

export interface StartedViewer {
  started: Promise<StartResult>;
  /** The viewer runs in the foreground; this resolves with the exit code `tribe` passes on. */
  exited: Promise<number>;
}

export interface ViewerIo {
  probe(port: number): Promise<ProbeSignal>;
  start(port: number): StartedViewer;
  openUrl(url: string): void;
  log(message: string): void;
  warn(message: string): void;
}

export interface ViewerOptions {
  port: number;
  open: boolean;
  strictPort: boolean;
}

export function viewerUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

/** Resolves with the process exit code for `tribe`. */
export async function runViewer(options: ViewerOptions, io: ViewerIo): Promise<number> {
  const lastPort = Math.min(options.port + MAX_PORT_ATTEMPTS - 1, 65535);

  for (let port = options.port; port <= lastPort; port += 1) {
    const verdict = classifyProbe(await io.probe(port));

    if (verdict === 'reuse') {
      io.log(`tribe viewer already running: ${viewerUrl(port)}`);
      if (options.open) io.openUrl(viewerUrl(port));
      return 0;
    }

    // 'stale' means the port answered as something that is not a current tribe viewer.
    const portIsFree = verdict === 'spawn';
    if (portIsFree) {
      const viewer = io.start(port);
      const started = await viewer.started;
      const portWasTaken = started.kind === 'exited' && started.code === VIEWER_EXIT_PORT_IN_USE;
      if (!portWasTaken) {
        if (started.kind === 'ready' && options.open) io.openUrl(viewerUrl(port));
        if (started.kind === 'timeout') io.warn(`tribe: the viewer on port ${port} did not answer yet — open ${viewerUrl(port)} yourself`);
        return viewer.exited;
      }
    }

    if (options.strictPort) {
      io.warn(`tribe: port ${port} is in use (--strict-port)`);
      return 1;
    }
    if (port < lastPort) io.log(`tribe: port ${port} is in use, trying ${port + 1}...`);
  }

  io.warn(`tribe: no free port in ${options.port}-${lastPort} — pass --port <n>`);
  return 1;
}
