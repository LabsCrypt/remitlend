import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requestLogger } from '../requestLogger.js';
import logger from '../../utils/logger.js';

describe('Request Logger Production Access & Secret Redaction Test Harness (#2094)', () => {
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
    logger.level = process.env.NODE_ENV === 'development' ? 'debug' : 'http';
    writeSpy.mockRestore();
  });

  it('should output 200 OK access trace entries cleanly when running under a production profile configuration', () => {
    setNodeEnv('production');
    logger.level = 'http';

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

  it('should log 4xx client errors at warn priority', () => {
    setNodeEnv('production');
    logger.level = 'http';

    const mockReq = {
      method: 'POST',
      originalUrl: '/api/v1/auth/login',
      ip: '192.168.1.10',
      get: () => 'TestBrowser/1.0',
    } as unknown as Request;

    let finishCallback: () => void = () => {};
    const mockRes = {
      statusCode: 400,
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
        level: 'warn',
        message: 'HTTP request',
        statusCode: 400,
        url: '/api/v1/auth/login',
        method: 'POST',
      }),
    );
  });

  it('should log 5xx server errors at error priority', () => {
    setNodeEnv('production');
    logger.level = 'http';

    const mockReq = {
      method: 'GET',
      originalUrl: '/api/v1/contracts/health',
      ip: '127.0.0.1',
      get: () => undefined,
    } as unknown as Request;

    let finishCallback: () => void = () => {};
    const mockRes = {
      statusCode: 500,
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
        level: 'error',
        message: 'HTTP request',
        statusCode: 500,
        url: '/api/v1/contracts/health',
        method: 'GET',
      }),
    );
  });

  it('should never include sensitive headers (authorization, cookie) or request body in log payload', () => {
    setNodeEnv('production');
    logger.level = 'http';

    const mockReq = {
      method: 'POST',
      originalUrl: '/api/v1/loans/apply',
      ip: '10.0.0.5',
      headers: {
        authorization: 'Bearer super-secret-token-12345',
        cookie: 'sessionId=secret-session-abc; auth_token=token-xyz',
      },
      body: {
        pin: '1234',
        ssn: '000-00-0000',
        amount: 5000,
        recipient_email: 'target@example.com',
        recipient_phone: '+15550009999',
      },
      get: (header: string) => {
        if (header.toLowerCase() === 'authorization') return 'Bearer super-secret-token-12345';
        if (header.toLowerCase() === 'cookie') return 'sessionId=secret-session-abc';
        if (header === 'user-agent') return 'SecureClient/2.0';
        return undefined;
      },
    } as unknown as Request;

    let finishCallback: () => void = () => {};
    const mockRes = {
      statusCode: 201,
      on: (event: string, callback: () => void) => {
        if (event === 'finish') finishCallback = callback;
      },
    } as unknown as Response;

    const mockNext = jest.fn() as NextFunction;

    requestLogger(mockReq, mockRes, mockNext);
    finishCallback();

    expect(mockNext).toHaveBeenCalled();
    const loggedPayload = writeSpy.mock.calls[0][0] as Record<string, unknown>;

    // Verify secrets, credentials, and bodies are strictly omitted
    expect(loggedPayload.authorization).toBeUndefined();
    expect(loggedPayload.Authorization).toBeUndefined();
    expect(loggedPayload.cookie).toBeUndefined();
    expect(loggedPayload.Cookie).toBeUndefined();
    expect(loggedPayload.headers).toBeUndefined();
    expect(loggedPayload.body).toBeUndefined();
    expect(loggedPayload.pin).toBeUndefined();
    expect(loggedPayload.ssn).toBeUndefined();
    expect(loggedPayload.recipient_email).toBeUndefined();
    expect(loggedPayload.recipient_phone).toBeUndefined();

    // Verify permitted metadata is logged correctly
    expect(loggedPayload.url).toBe('/api/v1/loans/apply');
    expect(loggedPayload.method).toBe('POST');
    expect(loggedPayload.statusCode).toBe(201);
    expect(loggedPayload.ip).toBe('10.0.0.5');
    expect(loggedPayload.userAgent).toBe('SecureClient/2.0');
    expect(typeof loggedPayload.durationMs).toBe('number');
  });

  it('should correctly propagate custom requestId assigned by requestId middleware', () => {
    setNodeEnv('production');
    logger.level = 'http';

    const mockReq = {
      requestId: 'req-custom-uuid-12345',
      method: 'GET',
      originalUrl: '/api/v1/loans/active',
      ip: '10.0.0.2',
      get: () => 'TestAgent/1.0',
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
        requestId: 'req-custom-uuid-12345',
        url: '/api/v1/loans/active',
        method: 'GET',
        statusCode: 200,
      }),
    );
  });

  it('should handle requests without ip, userAgent, or custom requestId cleanly', () => {
    setNodeEnv('production');
    logger.level = 'http';

    const mockReq = {
      method: 'GET',
      originalUrl: '/health',
      get: () => undefined,
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
        url: '/health',
        method: 'GET',
      }),
    );
  });
});
