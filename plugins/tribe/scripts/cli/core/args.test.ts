import { expect, test } from 'bun:test';
import { DEFAULT_PORT, parseArgs } from './args.ts';

test('bare `tribe` starts the viewer on the default port and opens the browser', () => {
  expect(parseArgs([])).toEqual({ kind: 'viewer', port: DEFAULT_PORT, open: true, strictPort: false, host: '127.0.0.1' });
});

test('--port, --no-open and --strict-port are read in any order', () => {
  expect(parseArgs(['--no-open', '--port', '5000', '--strict-port'])).toEqual({
    kind: 'viewer',
    port: 5000,
    open: false,
    strictPort: true,
    host: '127.0.0.1',
  });
});

test('--remote is kanna\'s shortcut for --host 0.0.0.0; --host binds a given address; the last one wins', () => {
  expect(parseArgs(['--remote'])).toMatchObject({ kind: 'viewer', host: '0.0.0.0' });
  expect(parseArgs(['--host', '192.168.1.20'])).toMatchObject({ kind: 'viewer', host: '192.168.1.20' });
  expect(parseArgs(['--remote', '--host', '192.168.1.20'])).toMatchObject({ host: '192.168.1.20' });
  expect(parseArgs(['--host', '192.168.1.20', '--remote'])).toMatchObject({ host: '0.0.0.0' });
});

test('a missing --host value refuses instead of reading the next flag as the value', () => {
  expect(parseArgs(['--host'])).toEqual({ kind: 'refuse', message: 'tribe: --host expects an address, got ""' });
  expect(parseArgs(['--host', '--remote'])).toEqual({ kind: 'refuse', message: 'tribe: --host expects an address, got "--remote"' });
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
