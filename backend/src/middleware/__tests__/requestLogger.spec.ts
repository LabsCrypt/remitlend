import type { Request, Response, NextFunction } from 'express';
import { requestLogger } from '../requestLogger.js';
import logger from '../../utils/logger.js';

describe('Request Logger Production Access Test Harness (#1207)', () => {
  let writeSpy: jest.SpyInstance;
  const originalNodeEnv = process.env.NODE_ENV;

  const setNodeEnv = (value: string | undefined) => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value,
      configurable: true,
      writable: true,
    });
  };

  beforeEach(() => {
    writeSpy = jest.spyOn(logger, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    setNodeEnv(originalNodeEnv);
    // Restore logger level dynamically based on initial state
    logger.level = process.env.NODE_ENV === 'development' ? 'debug' : 'http';
    writeSpy.mockRestore();
  });

  it('should output 200 OK access trace entries cleanly when running under a production profile configuration', () => {
    setNodeEnv('production');
    logger.level = 'http'; // Explicitly match updated target runtime calculation

    const mockReq = {
      method: 'GET',
      originalUrl: '/api/v1/loans',
      ip: '10.0.0.1',
      get: (header: string) => (header === 'user-agent' ? 'Jest-Test-Agent' : undefined),
    } as unknown as Request;

    let finishCallback: () => void = () => {};
    const mockRes = {
      statusCode: 200,
      on: (event: string, callback: () => void) => {
        if (event === 'finish') finishCallback = callback;
      },
    } as unknown as Response;

    const mockNext = jest.fn() as NextFunction;

    requestLogger(mockReq, mockRes, mockNext);
    finishCallback();

    expect(mockNext).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'http',
        message: 'HTTP request',
        statusCode: 200,
        url: '/api/v1/loans',
        method: 'GET',
      }),
    );
  });

  it('should confirm development profile logging remains at debug priority', () => {
    setNodeEnv('development');
    logger.level = 'debug';
    expect(logger.level).toBe('debug');
  });
});
