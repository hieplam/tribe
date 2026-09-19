import { expect, test } from 'bun:test';
import { DEFAULT_PORT, parseArgs } from './args.ts';

test('bare `tribe` starts the viewer on the default port and opens the browser', () => {
  expect(parseArgs([])).toEqual({ kind: 'viewer', port: DEFAULT_PORT, open: true, strictPort: false });
});

test('--port, --no-open and --strict-port are read in any order', () => {
  expect(parseArgs(['--no-open', '--port', '5000', '--strict-port'])).toEqual({
    kind: 'viewer',
    port: 5000,
    open: false,
    strictPort: true,
  });
});

test('--help / -h and --version / -v win over everything else', () => {
  expect(parseArgs(['--port', '5000', '--help'])).toEqual({ kind: 'help' });
  expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
  expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
});

test('a missing --port value refuses instead of reading the next flag as the value', () => {
  expect(parseArgs(['--port'])).toEqual({ kind: 'refuse', message: 'tribe: --port expects an integer 1-65535, got ""' });
  expect(parseArgs(['--port', '--no-open'])).toEqual({
    kind: 'refuse',
    message: 'tribe: --port expects an integer 1-65535, got "--no-open"',
  });
});

test('a --port outside 1-65535 or not an integer refuses', () => {
  for (const bad of ['0', '65536', 'abc', '43.5', '-1', '']) {
    expect(parseArgs(['--port', bad]).kind).toBe('refuse');
  }
});

test('an unknown flag or a positional argument refuses, naming it', () => {
  expect(parseArgs(['--custom'])).toEqual({ kind: 'refuse', message: 'tribe: unknown option --custom (see tribe --help)' });
  expect(parseArgs(['serve'])).toEqual({ kind: 'refuse', message: 'tribe: unknown option serve (see tribe --help)' });
});
