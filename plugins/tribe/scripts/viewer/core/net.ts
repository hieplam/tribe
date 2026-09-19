// core/net.ts — pure network decisions for the viewer's bind address (`--host`) and its
// Host/Origin gate. `serve.ts` hands in `os.networkInterfaces()` flattened; nothing here reads
// the machine itself. The `tribe` CLI imports `lanIPv4Addresses` too, so there is one reader of
// the interface list.

export interface NetAddress {
  address: string;
  /** 'IPv4' | 'IPv6' on current runtimes; older Node reported 4 | 6. */
  family: string | number;
  internal: boolean;
}

/** The addresses another device on the local network can reach this machine at. */
export function lanIPv4Addresses(addresses: NetAddress[]): string[] {
  return addresses.filter((a) => !a.internal && (a.family === 'IPv4' || a.family === 4)).map((a) => a.address);
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost';
}

/** Listen on every IPv4 interface — what `tribe --remote` asks for. */
export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0';
}

/** `null` when the viewer can listen on `host`, else the one-line refusal. Checked before
 * `Bun.serve`, because Bun reports a host that is not this machine's as EADDRINUSE — the
 * "port in use" error — which would send the `tribe` CLI walking to the next port.
 * IPv4 only: an IPv6 host needs bracketed URLs and its own Host rule, which nothing here
 * builds, so it is refused rather than half-working. */
export function bindHostRefusal(host: string, localAddresses: NetAddress[]): string | null {
  if (isWildcardHost(host) || isLoopbackHost(host)) return null;
  if (!IPV4_RE.test(host)) return `viewer: --host ${host} is not supported — use 0.0.0.0, localhost, or an IPv4 address of this machine`;
  if (localAddresses.some((a) => a.address === host)) return null;
  return `viewer: --host ${host} is not an address of this machine`;
}
const LOOPBACK_HOST_HEADER_RE = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

/** The host part of a `name[:port]` Host header, or `null` when the shape is anything else
 * (a non-numeric port, a second colon, an IPv6 bracket form — none of which reach an IPv4 bind). */
function hostPart(hostHeader: string): string | null {
  const match = /^([^:]+)(:\d+)?$/.exec(hostHeader);
  return match === null ? null : match[1]!;
}

/** The DNS-rebinding defence (spec §12.5, B16). A rebinding attack needs a domain name the
 * attacker controls to resolve to this machine, so a request addressed by a DNS name other than
 * `localhost` (or an mDNS `*.local` name, which public DNS cannot serve) is refused.
 * - loopback-bound (the default): only `127.0.0.1` and `localhost`, unchanged from before;
 * - network-bound (`--host 0.0.0.0` / a LAN address): also any IPv4 literal and `*.local`, which is
 *   how another device on the network addresses this machine. */
export function hostHeaderAllowed(hostHeader: string, networkBound: boolean): boolean {
  if (LOOPBACK_HOST_HEADER_RE.test(hostHeader)) return true;
  if (!networkBound) return false;
  const host = hostPart(hostHeader)?.toLowerCase();
  if (host === undefined) return false;
  if (IPV4_RE.test(host)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(host);
}
