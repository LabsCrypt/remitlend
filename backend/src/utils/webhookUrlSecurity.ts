import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface ResolvedPublicAddress {
  address: string;
  family: 4 | 6;
}

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [subnet, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIpv4Addresses.addSubnet(subnet, prefix, 'ipv4');
}

for (const [subnet, prefix] of [
  ['::', 128],
  ['::1', 128],
  // Reject IPv4-mapped destinations outright so alternate mapped spellings
  // cannot bypass the IPv4 block list.
  ['::ffff:0:0', 96],
  // NAT64 prefixes can encode IPv4 destinations, including private addresses.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  blockedIpv6Addresses.addSubnet(subnet, prefix, 'ipv6');
}

function normalizeIpv4MappedAddress(address: string): string | undefined {
  const match = /^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([\da-f]{1,4}):([\da-f]{1,4}))$/i.exec(
    address,
  );
  if (!match) return undefined;
  if (match[1]) return match[1];

  const high = Number.parseInt(match[2]!, 16);
  const low = Number.parseInt(match[3]!, 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isPrivateIp(address: string): boolean {
  const normalized = normalizeIpv4MappedAddress(address) ?? address;
  const family = isIP(normalized);
  if (family === 0) return true;
  return family === 4
    ? blockedIpv4Addresses.check(normalized, 'ipv4')
    : blockedIpv6Addresses.check(normalized, 'ipv6');
}

/** Resolve once, reject mixed public/private answers, and return an address to pin to the request. */
export async function resolvePublicAddress(hostname: string): Promise<ResolvedPublicAddress> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal' ||
    (!host.includes('.') && !host.includes(':') && isIP(host) === 0)
  ) {
    throw new Error('Webhook target hostname is not public');
  }

  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) throw new Error('Webhook target address is not public');
    return { address: host, family: isIP(host) as 4 | 6 };
  }

  const addresses = await dnsLookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Webhook target hostname resolves to a non-public address');
  }

  const address = addresses[0]!;
  return { address: address.address, family: address.family as 4 | 6 };
}

export async function isPrivateHost(hostname: string): Promise<boolean> {
  try {
    await resolvePublicAddress(hostname);
    return false;
  } catch {
    return true;
  }
}
