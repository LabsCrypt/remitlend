import { afterEach, describe, expect, it, jest } from '@jest/globals';

const mockLookup = jest.fn();
jest.unstable_mockModule('node:dns/promises', () => ({ lookup: mockLookup }));

const { isPrivateHost, isPrivateIp, resolvePublicAddress } =
  await import('../webhookUrlSecurity.js');

describe('webhook URL address validation', () => {
  afterEach(() => mockLookup.mockReset());

  it('rejects private, loopback, link-local, and IPv4-mapped addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('10.2.3.4')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('rejects a hostname when any DNS answer is non-public', async () => {
    mockLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);

    await expect(resolvePublicAddress('attacker.example')).rejects.toThrow('non-public address');
    await expect(isPrivateHost('attacker.example')).resolves.toBe(true);
  });

  it('accepts public DNS results and rejects unresolvable hostnames', async () => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    await expect(resolvePublicAddress('consumer.example')).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
    });

    mockLookup.mockRejectedValue(new Error('not found'));
    await expect(isPrivateHost('missing.example')).resolves.toBe(true);
  });
});

describe('webhook URL address validation edge cases', () => {
  afterEach(() => mockLookup.mockReset());

  it.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.2.3.4',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('treats reserved IPv4 address %s as private', (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.1.1',
    '192.0.3.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
  ])('treats public IPv4 boundary address %s as non-private', (address) => {
    expect(isPrivateIp(address)).toBe(false);
  });

  it.each([
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '64:ff9b::c0a8:101',
    '64:ff9b:1::c0a8:101',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:192.168.1.1',
    '::ffff:c0a8:101',
  ])('treats blocked IPv6 literal %s as private', (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001::200e'])(
    'treats public IPv6 literal %s as non-private',
    (address) => {
      expect(isPrivateIp(address)).toBe(false);
    },
  );

  it.each(['not-an-ip', '256.1.1.1', '::gg', ''])(
    'treats malformed address %p as private',
    (address) => {
      expect(isPrivateIp(address)).toBe(true);
    },
  );

  it.each([
    'localhost',
    'LOCALHOST',
    'api.localhost',
    'api.local',
    'metadata.google.internal',
    'intranet',
  ])('rejects non-public hostname %s without a DNS lookup', async (hostname) => {
    await expect(resolvePublicAddress(hostname)).rejects.toThrow('hostname is not public');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '169.254.169.254', '::1', '[::1]', '[::ffff:127.0.0.1]'])(
    'rejects non-public literal %s before any DNS lookup',
    async (literal) => {
      await expect(resolvePublicAddress(literal)).rejects.toThrow('address is not public');
      expect(mockLookup).not.toHaveBeenCalled();
    },
  );

  it('accepts public IPv4 and IPv6 literals without a DNS lookup', async () => {
    await expect(resolvePublicAddress('8.8.8.8')).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
    });
    await expect(resolvePublicAddress('2606:4700:4700::1111')).resolves.toEqual({
      address: '2606:4700:4700::1111',
      family: 6,
    });
    await expect(resolvePublicAddress('[2606:4700:4700::1111]')).resolves.toEqual({
      address: '2606:4700:4700::1111',
      family: 6,
    });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('normalizes hostname case and bracketed IPv6 before resolution', async () => {
    mockLookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);
    await expect(resolvePublicAddress('[2606:4700:4700::1111]')).resolves.toEqual({
      address: '2606:4700:4700::1111',
      family: 6,
    });
    await expect(resolvePublicAddress('Consumer.Example')).resolves.toEqual({
      address: '2606:4700:4700::1111',
      family: 6,
    });
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockLookup).toHaveBeenCalledWith('consumer.example', { all: true, verbatim: true });
  });

  it('rejects an empty DNS answer set', async () => {
    mockLookup.mockResolvedValue([]);
    await expect(resolvePublicAddress('empty.example')).rejects.toThrow('non-public address');
    await expect(isPrivateHost('empty.example')).resolves.toBe(true);
  });

  it('rejects mixed public and private DNS answers regardless of order', async () => {
    mockLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
      { address: '8.8.8.8', family: 4 },
    ]);
    await expect(resolvePublicAddress('mixed.example')).rejects.toThrow('non-public address');
  });

  it.each([
    { address: '::1', family: 6 },
    { address: 'fc00::1', family: 6 },
    { address: '64:ff9b::c0a8:101', family: 6 },
    { address: '::ffff:127.0.0.1', family: 6 },
    { address: '192.168.1.10', family: 4 },
  ])('rejects a DNS answer set containing %p', async (privateAnswer) => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, privateAnswer]);
    await expect(resolvePublicAddress('mixed.example')).rejects.toThrow('non-public address');
  });

  it('pins the first public DNS answer and preserves its address family', async () => {
    mockLookup.mockResolvedValue([
      { address: '2606:4700:4700::1111', family: 6 },
      { address: '8.8.8.8', family: 4 },
    ]);
    await expect(resolvePublicAddress('public.example')).resolves.toEqual({
      address: '2606:4700:4700::1111',
      family: 6,
    });
    expect(mockLookup).toHaveBeenCalledWith('public.example', { all: true, verbatim: true });
  });

  it('re-resolves on every call so a rebound hostname is refused when it turns private', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    await expect(resolvePublicAddress('rebind.example')).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
    });

    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(resolvePublicAddress('rebind.example')).rejects.toThrow('non-public address');
    await expect(isPrivateHost('rebind.example')).resolves.toBe(true);
    expect(mockLookup).toHaveBeenCalledTimes(3);
  });

  it('classifies redirect targets as private before they can be followed', async () => {
    const linkLocalRedirect = new URL('http://169.254.169.254/latest/meta-data/');
    const loopbackRedirect = new URL('http://127.0.0.1/admin');
    const ipv6Redirect = new URL('http://[::1]/admin');

    await expect(isPrivateHost(linkLocalRedirect.hostname)).resolves.toBe(true);
    await expect(isPrivateHost(loopbackRedirect.hostname)).resolves.toBe(true);
    await expect(isPrivateHost(ipv6Redirect.hostname)).resolves.toBe(true);
  });

  it('classifies a redirect hostname with a private DNS answer as unsafe', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const redirectTarget = new URL('https://internal.example/admin');
    await expect(isPrivateHost(redirectTarget.hostname)).resolves.toBe(true);
  });

  it('propagates DNS failures from resolvePublicAddress and maps them in isPrivateHost', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(resolvePublicAddress('missing.example')).rejects.toThrow('ENOTFOUND');
    await expect(isPrivateHost('missing.example')).resolves.toBe(true);
  });
});
