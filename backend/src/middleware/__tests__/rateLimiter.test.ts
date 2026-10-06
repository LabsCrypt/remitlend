import { describe, it, expect, jest, beforeAll, afterEach } from '@jest/globals';

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerDebug = jest.fn();

const mockLogger = {
  info: mockLoggerInfo,
  warn: mockLoggerWarn,
  error: mockLoggerError,
  debug: mockLoggerDebug,
  withContext: () => mockLogger,
};

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

const mockOn = jest.fn();
const mockConnect = jest.fn<() => Promise<void>>();
const mockSendCommand = jest.fn<(...args: string[]) => Promise<unknown>>();

jest.unstable_mockModule('redis', () => ({
  createClient: () => ({
    on: mockOn,
    connect: mockConnect,
    sendCommand: mockSendCommand,
    isOpen: false,
  }),
}));

const { createRateLimiter } = await import('../rateLimiter.js');

const originalNodeEnv = process.env.NODE_ENV;
const originalJestWorkerId = process.env.JEST_WORKER_ID;

let errorHandler: ((err: Error) => void) | undefined;

describe('rateLimiter Redis client error handling (#1852)', () => {
  beforeAll(() => {
    // The store (and thus the Redis client) is only built outside the test env,
    // so emulate a dev environment while creating a limiter once. The module
    // caches the client, so the handler is captured a single time.
    // Return a plausible SCRIPT LOAD reply so the store initializes quietly.
    mockSendCommand.mockResolvedValue('mock-sha');
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = 'development';
    createRateLimiter(5, 1, 'error-handler-test');

    const errorCall = mockOn.mock.calls.find(([event]) => event === 'error');
    if (!errorCall) {
      throw new Error("Redis client 'error' handler was not registered");
    }
    errorHandler = errorCall[1] as (err: Error) => void;
  });

  afterEach(() => {
    mockLoggerError.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerDebug.mockClear();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalJestWorkerId !== undefined) {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    } else {
      delete process.env.JEST_WORKER_ID;
    }
  });

  it('registers an error handler on the Redis client', () => {
    expect(errorHandler).toEqual(expect.any(Function));
  });

  it('logs when the Redis client emits an error outside the test environment', () => {
    process.env.NODE_ENV = 'development';
    errorHandler!(new Error('Redis connection failed'));

    expect(mockLoggerError).toHaveBeenCalledWith('Rate limiter Redis client error', {
      error: expect.any(Error),
    });
  });

  it('stays silent in the test environment to keep test output clean', () => {
    process.env.NODE_ENV = 'test';
    errorHandler!(new Error('Redis connection failed'));

    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});
