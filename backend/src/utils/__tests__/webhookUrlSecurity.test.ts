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
