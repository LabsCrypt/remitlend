import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockCreateRequestId = jest.fn<() => string>().mockReturnValue('server-generated-id');
const mockRunWithRequestContext = jest.fn<(id: string, fn: () => void) => void>((_id, fn) => fn());

jest.unstable_mockModule('../../utils/requestContext.js', () => ({
  createRequestId: mockCreateRequestId,
  runWithRequestContext: mockRunWithRequestContext,
}));

const { requestIdMiddleware } = await import('../requestId.js');

describe('requestIdMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      header: jest.fn<(name: string) => string | undefined>().mockReturnValue(undefined),
    };
    mockResponse = {
      setHeader: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('generates a server ID when no header is present', () => {
    requestIdMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockCreateRequestId).toHaveBeenCalled();
    expect(mockRequest.requestId).toBe('server-generated-id');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('x-request-id', 'server-generated-id');
  });

  it('accepts a valid UUID-like request ID', () => {
    (mockRequest.header as jest.Mock).mockReturnValue('550e8400-e29b-41d4-a716-446655440000');

    requestIdMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockRequest.requestId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(mockCreateRequestId).not.toHaveBeenCalled();
  });

  it('rejects an oversized request ID and falls back to server-generated', () => {
    const oversized = 'a'.repeat(129);
    (mockRequest.header as jest.Mock).mockReturnValue(oversized);

    requestIdMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockCreateRequestId).toHaveBeenCalled();
    expect(mockRequest.requestId).toBe('server-generated-id');
  });

  it('rejects a request ID with disallowed characters and falls back', () => {
    (mockRequest.header as jest.Mock).mockReturnValue('valid<id>with<script>');

    requestIdMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockCreateRequestId).toHaveBeenCalled();
    expect(mockRequest.requestId).toBe('server-generated-id');
  });

  it('accepts an ID at the maximum length boundary', () => {
    const maxLength = 'a'.repeat(128);
    (mockRequest.header as jest.Mock).mockReturnValue(maxLength);

    requestIdMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockRequest.requestId).toBe(maxLength);
    expect(mockCreateRequestId).not.toHaveBeenCalled();
  });
});
