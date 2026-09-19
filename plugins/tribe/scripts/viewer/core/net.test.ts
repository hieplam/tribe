import { expect, test } from 'bun:test';
import { bindHostRefusal, hostHeaderAllowed, isLoopbackHost, isWildcardHost, lanIPv4Addresses, type NetAddress } from './net.ts';

const addrs: NetAddress[] = [
  { address: '127.0.0.1', family: 'IPv4', internal: true },
  { address: '::1', family: 'IPv6', internal: true },
  { address: '192.168.1.20', family: 'IPv4', internal: false },
  { address: 'fe80::1', family: 'IPv6', internal: false },
  { address: '10.0.0.5', family: 4, internal: false }, // older Node reports family as a number
];

test('lanIPv4Addresses keeps only non-internal IPv4, in interface order', () => {
  expect(lanIPv4Addresses(addrs)).toEqual(['192.168.1.20', '10.0.0.5']);
});

test('isLoopbackHost: 127.0.0.1 and localhost; isWildcardHost: 0.0.0.0', () => {
  expect(isLoopbackHost('127.0.0.1')).toBe(true);
  expect(isLoopbackHost('localhost')).toBe(true);
  expect(isWildcardHost('0.0.0.0')).toBe(true);
  expect(isWildcardHost('127.0.0.1')).toBe(false);
  expect(isLoopbackHost('0.0.0.0')).toBe(false);
  expect(isLoopbackHost('192.168.1.20')).toBe(false);
});

test('bindHostRefusal accepts the wildcard, loopback, and this machine\'s own addresses', () => {
  for (const ok of ['0.0.0.0', '127.0.0.1', 'localhost', '192.168.1.20']) {
    expect(bindHostRefusal(ok, addrs)).toBeNull();
  }
});

test('bindHostRefusal names a host this machine cannot listen on (Bun would misreport it as "port in use")', () => {
  expect(bindHostRefusal('10.254.254.254', addrs)).toBe('viewer: --host 10.254.254.254 is not an address of this machine');
});

test('bindHostRefusal refuses IPv6 and names, which the URLs and Host rule do not handle', () => {
  for (const host of ['::', '::1', 'fe80::1', 'example.com']) {
    expect(bindHostRefusal(host, addrs)).toBe(
      `viewer: --host ${host} is not supported — use 0.0.0.0, localhost, or an IPv4 address of this machine`,
    );
  }
});

test('loopback-bound: Host must be 127.0.0.1 or localhost, exactly as before', () => {
  expect(hostHeaderAllowed('127.0.0.1:4321', false)).toBe(true);
  expect(hostHeaderAllowed('localhost:4321', false)).toBe(true);
  expect(hostHeaderAllowed('localhost', false)).toBe(true);
  expect(hostHeaderAllowed('192.168.1.20:4321', false)).toBe(false);
  expect(hostHeaderAllowed('mac.local:4321', false)).toBe(false);
  expect(hostHeaderAllowed('evil.example.com', false)).toBe(false);
});

test('network-bound: any IP literal, localhost or *.local is allowed — a DNS-rebinding domain still is not', () => {
  expect(hostHeaderAllowed('192.168.1.20:4321', true)).toBe(true);
  expect(hostHeaderAllowed('10.0.0.5', true)).toBe(true);
  expect(hostHeaderAllowed('Hips-MacBook.local:4321', true)).toBe(true);
  expect(hostHeaderAllowed('localhost:4321', true)).toBe(true);
  expect(hostHeaderAllowed('evil.example.com', true)).toBe(false);
  expect(hostHeaderAllowed('192.168.1.20.evil.com:4321', true)).toBe(false);
  expect(hostHeaderAllowed('999.1.1.1', true)).toBe(false);
  expect(hostHeaderAllowed('', true)).toBe(false);
  // Shapes a browser never sends to an IPv4 bind — refused rather than half-parsed.
  for (const odd of ['[fe80::1]:4321', '[evil.com]', '[x]evil.com', '[]', '1.2.3.4:abc', '1.2.3.4:80:80']) {
    expect(hostHeaderAllowed(odd, true)).toBe(false);
  }
});
