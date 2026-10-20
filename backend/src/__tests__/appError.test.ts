import { describe, it, expect } from '@jest/globals';
import { AppError } from '../errors/AppError.js';
import { ErrorCode, getDefaultErrorCodeForStatus } from '../errors/errorCodes.js';

describe('AppError', () => {
  describe('AppError.badRequest()', () => {
    it('defaults to ErrorCode.VALIDATION_ERROR when no explicit errorCode is provided (#1863)', () => {
      const err = AppError.badRequest();

      expect(err.statusCode).toBe(400);
      expect(err.status).toBe('fail');
      expect(err.isOperational).toBe(true);
      expect(err.message).toBe('Bad request');
      expect(err.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
      expect(err.errorCode).not.toBe(ErrorCode.INVALID_AMOUNT);
    });

    it('defaults to ErrorCode.VALIDATION_ERROR with custom message', () => {
      const err = AppError.badRequest('Missing recipient address');

      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Missing recipient address');
      expect(err.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('respects explicitly provided errorCode like INVALID_AMOUNT', () => {
      const err = AppError.badRequest(
        'Amount must be positive',
        ErrorCode.INVALID_AMOUNT,
        'amount',
      );

      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Amount must be positive');
      expect(err.errorCode).toBe(ErrorCode.INVALID_AMOUNT);
      expect(err.field).toBe('amount');
    });

    it('respects other explicit errorCodes and fields', () => {
      const err = AppError.badRequest('Invalid loan ID', ErrorCode.INVALID_LOAN_ID, 'loanId');

      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Invalid loan ID');
      expect(err.errorCode).toBe(ErrorCode.INVALID_LOAN_ID);
      expect(err.field).toBe('loanId');
    });
  });

  describe('Other factory methods default error codes', () => {
    it('unauthorized defaults to ErrorCode.UNAUTHORIZED', () => {
      const err = AppError.unauthorized();
      expect(err.statusCode).toBe(401);
      expect(err.errorCode).toBe(ErrorCode.UNAUTHORIZED);
    });

    it('forbidden defaults to ErrorCode.FORBIDDEN', () => {
      const err = AppError.forbidden();
      expect(err.statusCode).toBe(403);
      expect(err.errorCode).toBe(ErrorCode.FORBIDDEN);
    });

    it('notFound defaults to ErrorCode.NOT_FOUND', () => {
      const err = AppError.notFound();
      expect(err.statusCode).toBe(404);
      expect(err.errorCode).toBe(ErrorCode.NOT_FOUND);
    });

    it('conflict defaults to ErrorCode.CONFLICT', () => {
      const err = AppError.conflict();
      expect(err.statusCode).toBe(409);
      expect(err.errorCode).toBe(ErrorCode.CONFLICT);
    });

    it('internal defaults to ErrorCode.INTERNAL_ERROR and isOperational=false', () => {
      const err = AppError.internal();
      expect(err.statusCode).toBe(500);
      expect(err.errorCode).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.isOperational).toBe(false);
      expect(err.status).toBe('error');
    });

    it('serviceUnavailable defaults to ErrorCode.SERVICE_UNAVAILABLE', () => {
      const err = AppError.serviceUnavailable();
      expect(err.statusCode).toBe(503);
      expect(err.errorCode).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    });

    it('validation defaults to ErrorCode.VALIDATION_ERROR with field and details', () => {
      const err = AppError.validation('Invalid input', 'email', { reason: 'malformed' });
      expect(err.statusCode).toBe(400);
      expect(err.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
      expect(err.field).toBe('email');
      expect(err.details).toEqual({ reason: 'malformed' });
    });

    it('withCode loads metadata from ERROR_CODE_REGISTRY', () => {
      const err = AppError.withCode(ErrorCode.LOAN_NOT_FOUND);
      expect(err.statusCode).toBe(404);
      expect(err.errorCode).toBe(ErrorCode.LOAN_NOT_FOUND);
      expect(err.message).toBe('Loan not found');
    });
  });

  describe('getDefaultErrorCodeForStatus', () => {
    it('maps status codes to standard error codes', () => {
      expect(getDefaultErrorCodeForStatus(400)).toBe(ErrorCode.VALIDATION_ERROR);
      expect(getDefaultErrorCodeForStatus(401)).toBe(ErrorCode.UNAUTHORIZED);
      expect(getDefaultErrorCodeForStatus(403)).toBe(ErrorCode.FORBIDDEN);
      expect(getDefaultErrorCodeForStatus(404)).toBe(ErrorCode.NOT_FOUND);
      expect(getDefaultErrorCodeForStatus(409)).toBe(ErrorCode.CONFLICT);
      expect(getDefaultErrorCodeForStatus(429)).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(getDefaultErrorCodeForStatus(503)).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(getDefaultErrorCodeForStatus(500)).toBe(ErrorCode.INTERNAL_ERROR);
    });
  });
});
