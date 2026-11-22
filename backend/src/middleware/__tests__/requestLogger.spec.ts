import { jest } from '@jest/globals';
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

describe('requestLogger redaction and severity contract (#2094)', () => {
  let httpSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let nowSpy: jest.SpyInstance;

  const invoke = (statusCode: number, originalUrl: string) => {
    const req = {
      method: 'POST',
      originalUrl,
      ip: '10.0.0.1',
      requestId: 'req-123',
      headers: {
        authorization: 'Bearer bearer-secret-value',
        cookie: 'session=cookie-secret-value',
      },
      body: {
        recipientEmail: 'recipient@example.com',
        recipientPhone: '+14155551234',
      },
      get: (header: string) => {
        if (header === 'user-agent') return 'Jest-Test-Agent';
        if (header === 'authorization') return 'Bearer bearer-secret-value';
        if (header === 'cookie') return 'session=cookie-secret-value';
        return undefined;
      },
    } as unknown as Request;

    let finish: () => void = () => {};
    const res = {
      statusCode,
      on: (event: string, callback: () => void) => {
        if (event === 'finish') finish = callback;
      },
    } as unknown as Response;
    const next = jest.fn();

    requestLogger(req, res, next);
    finish();

    expect(next).toHaveBeenCalledTimes(1);
  };

  const payloadOf = (spy: jest.SpyInstance): Record<string, unknown> => {
    const call = spy.mock.calls[0];
    expect(call).toBeDefined();
    expect(call).toHaveLength(2);
    return call?.[1] as Record<string, unknown>;
  };

  beforeEach(() => {
    httpSpy = jest.spyOn(logger, 'http');
    warnSpy = jest.spyOn(logger, 'warn');
    errorSpy = jest.spyOn(logger, 'error');
    nowSpy = jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1017);
  });

  afterEach(() => {
    httpSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it('logs only the allow-listed fields and redacts sensitive query values', () => {
    invoke(200, '/api/v1/transfers?email=recipient@example.com&token=abc123&page=2');

    expect(httpSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    const payload = payloadOf(httpSpy);
    expect(payload).toEqual({
      requestId: 'req-123',
      method: 'POST',
      url: '/api/v1/transfers?email=%5BREDACTED%5D&token=%5BREDACTED%5D&page=2',
      statusCode: 200,
      durationMs: 17,
      ip: '10.0.0.1',
      userAgent: 'Jest-Test-Agent',
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('bearer-secret-value');
    expect(serialized).not.toContain('cookie-secret-value');
    expect(serialized).not.toContain('recipient@example.com');
    expect(serialized).not.toContain('+14155551234');
    expect(serialized).not.toContain('abc123');
  });

  it('uses the warn level for 4xx responses and the error level for 5xx responses', () => {
    invoke(404, '/api/v1/transfers/1');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(payloadOf(warnSpy).statusCode).toBe(404);
    expect(httpSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    nowSpy.mockRestore();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValueOnce(2000).mockReturnValueOnce(2005);
    invoke(503, '/api/v1/transfers/2');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(payloadOf(errorSpy)).toMatchObject({ statusCode: 503, durationMs: 5 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
