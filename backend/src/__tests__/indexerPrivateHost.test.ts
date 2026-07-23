import { describe, expect, it } from '@jest/globals';
import { isPrivateHost } from '../controllers/indexerController.js';

describe('isPrivateHost', () => {
  it('blocks the full 172.16.0.0/12 private range', () => {
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('172.16.255.254')).toBe(true);
    expect(isPrivateHost('172.31.255.254')).toBe(true);
  });

  it('does not classify neighboring public 172 ranges as private', () => {
    expect(isPrivateHost('172.15.255.254')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
  });
});