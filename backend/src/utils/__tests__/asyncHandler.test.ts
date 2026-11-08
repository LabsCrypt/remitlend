import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { asyncHandler } from '../asyncHandler.js';
import type { Request, Response, NextFunction } from 'express';

interface MockResponse extends Partial<Response> {
  headersSent: boolean;
  statusCode: number;
  writeHead: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
  send: jest.Mock;
  end: jest.Mock;
}

const createMockRes = (headersSent = false): MockResponse => {
  const res: MockResponse = {
    headersSent,
    statusCode: 200,
    writeHead: jest.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      res.headersSent = true;
      return res;
    }),
    status: jest.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation(() => {
      res.headersSent = true;
      return res;
    }),
    send: jest.fn().mockImplementation(() => {
      res.headersSent = true;
      return res;
    }),
    end: jest.fn().mockImplementation(() => {
      res.headersSent = true;
      return res;
    }),
  };
  return res;
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('asyncHandler (#2090)', () => {
  let mockReq: Partial<Request>;
  let mockRes: MockResponse;
  let next: jest.Mock;

  beforeEach(() => {
    mockReq = { method: 'GET', url: '/api/test' };
    mockRes = createMockRes();
    next = jest.fn();
  });

  describe('Rejected Promises After Headers Are Sent', () => {
    it('catches and forwards rejected promise when headers are already sent by res.writeHead()', async () => {
      const error = new Error('Streaming failed after response start');
      const handler = asyncHandler(async (_req, res) => {
        res.writeHead(200);
        expect(res.headersSent).toBe(true);
        await tick();
        throw error;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(error);
      expect(mockRes.headersSent).toBe(true);
    });

    it('catches and forwards rejected promise when headers are already sent by res.send()', async () => {
      const error = new Error('Deferred background processing failure');
      const handler = asyncHandler(async (_req, res) => {
        res.send({ status: 'partial' });
        expect(res.headersSent).toBe(true);
        await Promise.reject(error);
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(error);
      expect(mockRes.headersSent).toBe(true);
    });

    it('normalizes a non-Error rejection thrown after headersSent is set to true', async () => {
      const handler = asyncHandler(async (_req, res) => {
        res.json({ message: 'chunk delivered' });
        expect(res.headersSent).toBe(true);
        await tick();
        throw 'streaming pipe broke';
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toBe('Non-Error rejection: streaming pipe broke');
      expect(passed.cause).toBe('streaming pipe broke');
      expect(mockRes.headersSent).toBe(true);
    });

    it('catches rejection occurring when res.headersSent is initially true on entry', async () => {
      const alreadySentRes = createMockRes(true);
      const error = new Error('Immediate error on already-committed response');
      const handler = asyncHandler(async () => {
        throw error;
      });

      handler(
        mockReq as Request,
        alreadySentRes as unknown as Response,
        next as unknown as NextFunction,
      );
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('Standard Error Rejections Before Headers Are Sent', () => {
    it('forwards Error rejections as-is to next', async () => {
      const error = new Error('db failed');
      const handler = asyncHandler(async () => {
        throw error;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]?.[0]).toBe(error);
      expect(mockRes.headersSent).toBe(false);
    });

    it('preserves custom error properties (statusCode, code) on Error instances', async () => {
      const customError = Object.assign(new Error('Permission denied'), {
        statusCode: 403,
        code: 'ACCESS_DENIED',
      });
      const handler = asyncHandler(async () => {
        throw customError;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const forwarded = next.mock.calls[0]?.[0] as Error & { statusCode: number; code: string };
      expect(forwarded).toBe(customError);
      expect(forwarded.statusCode).toBe(403);
      expect(forwarded.code).toBe('ACCESS_DENIED');
    });

    it('preserves error subclasses (TypeError, RangeError, etc.) without mutating the instance', async () => {
      const typeError = new TypeError('Invalid buffer offset');
      const handler = asyncHandler(async () => {
        throw typeError;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const forwarded = next.mock.calls[0]?.[0];
      expect(forwarded).toBeInstanceOf(TypeError);
      expect(forwarded).toBe(typeError);
    });
  });

  describe('Non-Error Rejection Normalization', () => {
    it('normalizes a thrown string into an Error with cause and stack', async () => {
      const handler = asyncHandler(async () => {
        throw 'something went wrong';
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toBe('Non-Error rejection: something went wrong');
      expect(passed.cause).toBe('something went wrong');
      expect(passed.stack).toBeDefined();
    });

    it('normalizes undefined rejection into an Error with cause undefined', async () => {
      const handler = asyncHandler(async () => {
        throw undefined;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toBe('Non-Error rejection: undefined');
      expect(passed.cause).toBeUndefined();
      expect(passed.stack).toBeDefined();
    });

    it('normalizes null rejection into an Error with cause null', async () => {
      const handler = asyncHandler(async () => {
        throw null;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toBe('Non-Error rejection: null');
      expect(passed.cause).toBeNull();
    });

    it('normalizes number rejection into an Error with cause number', async () => {
      const handler = asyncHandler(async () => {
        throw 500;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toBe('Non-Error rejection: 500');
      expect(passed.cause).toBe(500);
    });

    it('normalizes boolean rejection into an Error with cause boolean', async () => {
      const handler = asyncHandler(async () => {
        throw false;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toBe('Non-Error rejection: false');
      expect(passed.cause).toBe(false);
    });

    it('normalizes plain object rejection into an Error preserving the object in cause', async () => {
      const plainObj = { code: 'FAIL', reason: 'timeout' };
      const handler = asyncHandler(async () => {
        throw plainObj;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toBe('Non-Error rejection: [object Object]');
      expect(passed.cause).toBe(plainObj);
    });

    it('normalizes symbol rejection into an Error with cause symbol', async () => {
      const sym = Symbol('REJECT_REASON');
      const handler = asyncHandler(async () => {
        throw sym;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toContain('Symbol(REJECT_REASON)');
      expect(passed.cause).toBe(sym);
    });
  });

  describe('Synchronous Exceptions & Execution Flow', () => {
    it('catches synchronously thrown errors inside an async handler function', async () => {
      const syncError = new Error('Sync initialization explosion');
      const handler = asyncHandler(async () => {
        throw syncError;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(syncError);
    });

    it('does NOT call next(err) on successful execution', async () => {
      const handler = asyncHandler(async (_req, res) => {
        res.status(200).json({ ok: true });
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(next).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: true });
    });

    it('passes through explicit next() call in middleware chaining', async () => {
      const handler = asyncHandler(async (_req, _res, n) => {
        await tick();
        n();
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();
      await tick();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('passes req, res, and next references faithfully to the inner handler', async () => {
      let receivedReq: Request | undefined;
      let receivedRes: Response | undefined;
      let receivedNext: NextFunction | undefined;

      const handler = asyncHandler(async (r, s, n) => {
        receivedReq = r;
        receivedRes = s;
        receivedNext = n;
      });

      handler(mockReq as Request, mockRes as unknown as Response, next as unknown as NextFunction);
      await tick();

      expect(receivedReq).toBe(mockReq);
      expect(receivedRes).toBe(mockRes);
      expect(receivedNext).toBe(next);
    });
  });
});
