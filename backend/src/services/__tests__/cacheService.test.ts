import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockConnect = jest.fn<() => Promise<void>>();
const mockOn = jest.fn();
const mockEval =
  jest.fn<(script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>>();

jest.unstable_mockModule('redis', () => ({
  createClient: () => ({
    connect: mockConnect,
    on: mockOn,
    eval: mockEval,
  }),
}));

const { cacheService } = await import('../cacheService.js');

describe('cacheService.deleteIfMatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
  });

  it('deletes the key when the stored value matches', async () => {
    mockEval.mockResolvedValueOnce(1);

    const result = await cacheService.deleteIfMatch('lock:test', 'my-lock-value');

    expect(result).toBe(true);
    expect(mockEval).toHaveBeenCalledTimes(1);
    const [script, options] = mockEval.mock.calls[0] as [
      string,
      { keys: string[]; arguments: string[] },
    ];
    expect(script).toContain('GET');
    expect(script).toContain('DEL');
    expect(options.keys).toEqual(['lock:test']);
  });

  it('returns false when the stored value does not match', async () => {
    mockEval.mockResolvedValueOnce(0);

    const result = await cacheService.deleteIfMatch('lock:test', 'wrong-value');

    expect(result).toBe(false);
  });

  it('returns false when the key does not exist', async () => {
    mockEval.mockResolvedValueOnce(0);

    const result = await cacheService.deleteIfMatch('lock:test', 'my-lock-value');

    expect(result).toBe(false);
  });

  it('returns false when Redis errors occur (fail-safe)', async () => {
    mockEval.mockRejectedValueOnce(new Error('Redis connection failed'));

    const result = await cacheService.deleteIfMatch('lock:test', 'my-lock-value');

    expect(result).toBe(false);
  });

  it('performs match-and-delete atomically in a single eval call', async () => {
    mockEval.mockResolvedValueOnce(1);

    await cacheService.deleteIfMatch('lock:test', 'value');

    expect(mockEval).toHaveBeenCalledTimes(1);
  });
});
