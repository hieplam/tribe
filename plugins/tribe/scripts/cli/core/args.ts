// core/args.ts — pure parse of the `tribe` command line. No process, no env: argv arrives as
// an input and every outcome, including a refusal, is a returned value (pure-core.md).

export const DEFAULT_PORT = 4321;

export type Command =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'viewer'; port: number; open: boolean; strictPort: boolean }
  | { kind: 'refuse'; message: string };

export const HELP = `tribe — the tribe toolbox

Usage:
  tribe [options]      start the read-only session viewer and open it in the browser

Options:
  --port <number>      port to listen on, 127.0.0.1 only (default: ${DEFAULT_PORT})
  --strict-port        fail instead of trying the next port when the port is taken
  --no-open            don't open the browser
  -v, --version        print the version and exit
  -h, --help           show this help`;

/** `args` is argv without the interpreter and script path. --help and --version win wherever
 * they appear, so a user can always ask for help even on an otherwise bad command line. */
export function parseArgs(args: string[]): Command {
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' };
  if (args.includes('--version') || args.includes('-v')) return { kind: 'version' };

  let port = DEFAULT_PORT;
  let open = true;
  let strictPort = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === '--port') {
      // A missing value is a refusal, never the next flag read as the value (fail-closed-edges).
      const value = args[index + 1] ?? '';
      const parsed = parsePort(value);
      if (parsed === null) return { kind: 'refuse', message: `tribe: --port expects an integer 1-65535, got ${JSON.stringify(value)}` };
      port = parsed;
      index += 1;
    } else if (arg === '--no-open') {
      open = false;
    } else if (arg === '--strict-port') {
      strictPort = true;
    } else {
      return { kind: 'refuse', message: `tribe: unknown option ${arg} (see tribe --help)` };
    }
  }

  return { kind: 'viewer', port, open, strictPort };
}

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}
