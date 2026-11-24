import { jest, describe, it, expect } from '@jest/globals';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { asyncHandler } from '../asyncHandler.js';

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockRes = (headersSent = false): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent,
  }) as unknown as Response;

describe('asyncHandler', () => {
  describe('error forwarding and normalization', () => {
    it('forwards Error rejections as-is to next', async () => {
      const error = new Error('db failed');
      const handler = asyncHandler(async () => {
        throw error;
      });

      const next = jest.fn();
      handler({} as Request, createMockRes(), next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]?.[0]).toBe(error);
    });

    it('normalizes a thrown string into an Error with a stack and cause', async () => {
      const handler = asyncHandler(async () => {
        throw 'something went wrong';
      });

      const next = jest.fn();
      handler({} as Request, createMockRes(), next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toContain('something went wrong');
      expect(passed.cause).toBe('something went wrong');
      expect(passed.stack).toBeDefined();
    });

    it('normalizes undefined rejection into an Error', async () => {
      const handler = asyncHandler(async () => {
        throw undefined;
      });

      const next = jest.fn();
      handler({} as Request, createMockRes(), next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toContain('undefined');
      expect(passed.cause).toBeUndefined();
      expect(passed.stack).toBeDefined();
    });

    it('normalizes null rejection into an Error with cause', async () => {
      const handler = asyncHandler(async () => {
        throw null;
      });

      const next = jest.fn();
      handler({} as Request, createMockRes(), next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.message).toContain('null');
      expect(passed.cause).toBeNull();
    });

    it('normalizes object rejection into an Error preserving the object as cause', async () => {
      const payload = { code: 'FAIL', detail: 'upstream down' };
      const handler = asyncHandler(async () => {
        throw payload;
      });

      const next = jest.fn();
      handler({} as Request, createMockRes(), next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      const passed = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(passed).toBeInstanceOf(Error);
      expect(passed.cause).toBe(payload);
    });

    it('catches and normalizes synchronous throws inside the handler', async () => {
      const syncError = new Error('sync crash');
      const handler = asyncHandler(() => {
        throw syncError;
      });

      const next = jest.fn();
      handler({} as Request, createMockRes(), next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]?.[0]).toBe(syncError);
    });
  });

  describe('rejected promises after headers are sent', () => {
    it('forwards Error rejection to next even when res.headersSent is true', async () => {
      const streamError = new Error('write failure after response started');
      const res = createMockRes(true);

      const handler = asyncHandler(async (_req, r) => {
        expect(r.headersSent).toBe(true);
        throw streamError;
      });

      const next = jest.fn();
      handler({} as Request, res, next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(streamError);
    });

    it('normalizes non-Error rejection to Error and forwards to next when headers are already sent', async () => {
      const res = createMockRes(true);
      const handler = asyncHandler(async () => {
        throw 'late socket hangup';
      });

      const next = jest.fn();
      handler({} as Request, res, next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0]?.[0] as Error & { cause?: unknown };
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('late socket hangup');
      expect(error.cause).toBe('late socket hangup');
    });

    it('handles synchronous exceptions when res.headersSent is true', async () => {
      const res = createMockRes(true);
      const handler = asyncHandler((_req, _res) => {
        throw new Error('sync error after headers');
      });

      const next = jest.fn();
      handler({} as Request, res, next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      expect((next.mock.calls[0]?.[0] as Error).message).toBe('sync error after headers');
    });

    it('invokes Express error handling with the forwarded error when headers have been sent in HTTP lifecycle', async () => {
      const app = express();
      let capturedError: unknown = null;
      let headersWereSentInErrorHandler = false;

      app.get(
        '/stream-error',
        asyncHandler(async (_req, res) => {
          // Send headers to client
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.write('initial-chunk');
          // Then reject
          throw new Error('rejection after partial response');
        }),
      );

      // Custom error middleware delegating to next(err) if headers are sent
      app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        capturedError = err;
        headersWereSentInErrorHandler = res.headersSent;
        if (res.headersSent) {
          res.end(); // close cleanly after recording error
          return;
        }
        res.status(500).json({ error: 'failed' });
      });

      const response = await request(app).get('/stream-error');

      expect(response.status).toBe(200);
      expect(headersWereSentInErrorHandler).toBe(true);
      expect(capturedError).toBeInstanceOf(Error);
      expect((capturedError as Error).message).toBe('rejection after partial response');
      expect(response.text).toContain('initial-chunk');
    });
  });

  describe('success paths', () => {
    it('does not invoke next with an error when async handler resolves normally', async () => {
      const handler = asyncHandler(async (_req, res) => {
        res.status(200).json({ success: true });
      });

      const res = createMockRes();
      const next = jest.fn();
      handler({} as Request, res, next as unknown as NextFunction);
      await flushAsync();

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(next).not.toHaveBeenCalled();
    });

    it('does not invoke next when synchronous handler completes normally', async () => {
      const handler = asyncHandler((_req, res) => {
        res.status(204).json(null);
      });

      const res = createMockRes();
      const next = jest.fn();
      handler({} as Request, res, next as unknown as NextFunction);
      await flushAsync();

      expect(res.status).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows handler to explicitly invoke next() for middleware chaining', async () => {
      const handler = asyncHandler(async (_req, _res, next) => {
        next();
      });

      const next = jest.fn();
      handler({} as Request, createMockRes(), next as unknown as NextFunction);
      await flushAsync();

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
