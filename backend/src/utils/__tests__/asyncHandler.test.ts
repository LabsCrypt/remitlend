import { jest } from '@jest/globals';
import { asyncHandler } from '../asyncHandler.js';
import type { Request, Response, NextFunction } from 'express';

const createMockRes = (): Response =>
  ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }) as unknown as Response;

describe('asyncHandler', () => {
  it('forwards Error rejections as-is to next', async () => {
    const error = new Error('db failed');
    const handler = asyncHandler(async () => {
      throw error;
    });

    const next = jest.fn();
    handler({} as Request, createMockRes(), next as unknown as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBe(error);
  });

  it('normalizes a thrown string into an Error with a stack', async () => {
    const handler = asyncHandler(async () => {
      throw 'something went wrong';
    });

    const next = jest.fn();
    handler({} as Request, createMockRes(), next as unknown as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledTimes(1);
    const passed = next.mock.calls[0]?.[0] as Error;
    expect(passed).toBeInstanceOf(Error);
    expect(passed.message).toContain('something went wrong');
    expect(passed.stack).toBeDefined();
  });

  it('normalizes undefined rejection into an Error', async () => {
    const handler = asyncHandler(async () => {
      throw undefined;
    });

    const next = jest.fn();
    handler({} as Request, createMockRes(), next as unknown as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledTimes(1);
    const passed = next.mock.calls[0]?.[0] as Error;
    expect(passed).toBeInstanceOf(Error);
    expect(passed.stack).toBeDefined();
  });
});
