// adapters/viewer.adapter.ts — the only file in the CLI that touches the world: the /healthz
// probe (reused from the runner, one reader of that shape), the foreground viewer child, the
// browser, and the clock that bounds the wait for the viewer to answer.
import { spawn } from 'node:child_process';
import { buildViewerPort, VIEWER_ENTRY_PATH } from '../../runner/adapters/viewer-launch.adapter.ts';
import { classifyProbe } from '../../runner/core/viewer-launch.ts';
import type { StartResult, ViewerIo } from '../core/viewer.ts';

const READY_POLL_MS = 100;
const READY_TIMEOUT_MS = 15_000;

/** The shell's "command could not be executed" code. */
const SPAWN_FAILED_EXIT = 127;

/** Signals `tribe` passes on to the viewer child, so Ctrl-C stops the viewer and then `tribe`. */
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** The platform's "open this URL in the default browser" command, as spawn arguments. */
function browserOpener(url: string): [string, string[]] {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

export function buildViewerIo(): ViewerIo {
  const viewerPort = buildViewerPort();
  return {
    probe: (port) => viewerPort.probeViewer(port),

    start(port) {
      // The viewer shares this terminal: its startup line and any refusal print directly.
      const child = spawn(process.execPath, [VIEWER_ENTRY_PATH, '--port', String(port)], { stdio: 'inherit' });
      const forward = (signal: NodeJS.Signals) => child.kill(signal);
      for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);
      const stopForwarding = () => {
        for (const signal of FORWARDED_SIGNALS) process.off(signal, forward);
      };

      const exited = new Promise<number>((resolve) => {
        child.on('error', (err) => {
          stopForwarding();
          console.error(`tribe: could not start the viewer: ${err.message}`);
          // Not 1: exit 1 means "port in use" to core/viewer.ts, and a spawn that cannot run
          // at all must not be retried on the next port.
          resolve(SPAWN_FAILED_EXIT);
        });
        child.on('exit', (code, signal) => {
          stopForwarding();
          // Stopped by a signal (Ctrl-C) is a normal way to end the viewer, not a failure.
          if (code !== null) resolve(code);
          else resolve(signal === null ? 1 : 0);
        });
      });

      const started = (async (): Promise<StartResult> => {
        let childExit: number | null = null;
        void exited.then((code) => (childExit = code));
        const deadline = Date.now() + READY_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (childExit !== null) return { kind: 'exited', code: childExit };
          if (classifyProbe(await viewerPort.probeViewer(port)) === 'reuse') return { kind: 'ready' };
          await Bun.sleep(READY_POLL_MS);
        }
        return { kind: 'timeout' };
      })();

      return { started, exited };
    },

    openUrl(url) {
      const opener = spawn(...browserOpener(url), { detached: true, stdio: 'ignore' });
      // No browser opener on this machine is not a failure: the URL is already printed.
      opener.on('error', () => console.error(`tribe: could not open a browser — visit ${url}`));
      opener.unref();
    },

    log: (message) => console.log(message),
    warn: (message) => console.error(message),
  };
}
