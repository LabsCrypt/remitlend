import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

jest.unstable_mockModule('../../services/authService.js', () => ({
  verifyJwtToken: jest.fn(),
  extractBearerToken: jest.fn(),
  isTokenRevoked: jest.fn(),
}));

jest.unstable_mockModule('../../auth/rbac.js', () => ({
  resolveRoleForWallet: jest.fn(),
  resolveScopesForRole: jest.fn(),
}));

const mockAppErrorUnauthorized = jest.fn();
const mockAppErrorForbidden = jest.fn();
const mockAppErrorBadRequest = jest.fn();

jest.unstable_mockModule('../../errors/AppError.js', () => ({
  AppError: {
    unauthorized: mockAppErrorUnauthorized,
    forbidden: mockAppErrorForbidden,
    badRequest: mockAppErrorBadRequest,
  },
}));

const { requireJwtAuth, requireScopes, requireWalletParamMatchesJwt } =
  await import('../jwtAuth.js');
const { verifyJwtToken, extractBearerToken, isTokenRevoked } =
  await import('../../services/authService.js');
const { resolveRoleForWallet, resolveScopesForRole } = await import('../../auth/rbac.js');

const mockVerifyJwtToken = verifyJwtToken as jest.MockedFunction<typeof verifyJwtToken>;
const mockExtractBearerToken = extractBearerToken as jest.MockedFunction<typeof extractBearerToken>;
const mockIsTokenRevoked = isTokenRevoked as jest.MockedFunction<typeof isTokenRevoked>;
const mockResolveRoleForWallet = resolveRoleForWallet as jest.MockedFunction<
  typeof resolveRoleForWallet
>;
const mockResolveScopesForRole = resolveScopesForRole as jest.MockedFunction<
  typeof resolveScopesForRole
>;

function createError(message: string, statusCode: number) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function mockAppErrorFactory(statusCode: number) {
  return (message: string) => createError(message, statusCode);
}

describe('jwtAuth middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      headers: {},
      params: {},
      body: {},
    };

    mockResponse = {} as Partial<Response>;

    mockNext = jest.fn();

    mockAppErrorUnauthorized.mockImplementation(
      mockAppErrorFactory(401) as unknown as typeof AppError.unauthorized,
    );
    mockAppErrorForbidden.mockImplementation(
      mockAppErrorFactory(403) as unknown as typeof AppError.forbidden,
    );
    mockAppErrorBadRequest.mockImplementation(
      mockAppErrorFactory(400) as unknown as typeof AppError.badRequest,
    );

    mockResolveRoleForWallet.mockReturnValue('borrower');
    mockResolveScopesForRole.mockReturnValue(['read:loans', 'read:score']);
  });

  describe('requireJwtAuth', () => {
    it('should authenticate with valid Authorization header token', async () => {
      const payload = {
        publicKey: 'GABCDEF123',
        role: 'borrower' as const,
        scopes: ['read:loans'],
        jti: 'test-jti',
        iat: 1000,
        exp: 2000,
      };
      mockExtractBearerToken.mockReturnValue('valid-token');
      mockVerifyJwtToken.mockReturnValue(payload);
      mockIsTokenRevoked.mockResolvedValue(false);

      await requireJwtAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockExtractBearerToken).toHaveBeenCalledWith(mockRequest.headers.authorization);
      expect(mockVerifyJwtToken).toHaveBeenCalledWith('valid-token');
      expect(mockIsTokenRevoked).toHaveBeenCalled();
      expect(mockRequest.user).toBeDefined();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should authenticate with valid cookie token when no Authorization header', async () => {
      mockExtractBearerToken.mockReturnValue(null);

      const payload = {
        publicKey: 'GCOOKIE_USER',
        role: 'lender' as const,
        scopes: ['read:loans', 'read:pool'],
        iat: 1000,
        exp: 2000,
      };
      mockVerifyJwtToken.mockReturnValue(payload);
      mockIsTokenRevoked.mockResolvedValue(false);

      mockRequest.headers = {
        cookie: 'remitlend_jwt=valid-cookie-token',
      };

      await requireJwtAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockExtractBearerToken).toHaveBeenCalledWith(undefined);
      expect(mockVerifyJwtToken).toHaveBeenCalledWith('valid-cookie-token');
      expect(mockRequest.user).toBeDefined();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should throw 401 when no token is provided', async () => {
      mockExtractBearerToken.mockReturnValue(null);
      mockRequest.headers = {};

      await expect(() =>
        requireJwtAuth(mockRequest as Request, mockResponse as Response, mockNext),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
        }),
      );

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should throw 401 when token is invalid or expired', async () => {
      mockExtractBearerToken.mockReturnValue('invalid-token');
      mockVerifyJwtToken.mockReturnValue(null);

      await expect(() =>
        requireJwtAuth(mockRequest as Request, mockResponse as Response, mockNext),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
        }),
      );

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should throw 401 when token has been revoked', async () => {
      const payload = {
        publicKey: 'GREVOKED',
        role: 'borrower' as const,
        scopes: [],
        jti: 'some-jti',
        iat: 1000,
        exp: 2000,
      };
      mockExtractBearerToken.mockReturnValue('revoked-token');
      mockVerifyJwtToken.mockReturnValue(payload);
      mockIsTokenRevoked.mockResolvedValue(true);

      await expect(() =>
        requireJwtAuth(mockRequest as Request, mockResponse as Response, mockNext),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
        }),
      );

      expect(mockIsTokenRevoked).toHaveBeenCalledWith('some-jti');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle URL-encoded cookie values', async () => {
      mockExtractBearerToken.mockReturnValue(null);

      const payload = {
        publicKey: 'GURLENC_USER',
        role: 'borrower' as const,
        scopes: [],
        iat: 1000,
        exp: 2000,
      };
      mockVerifyJwtToken.mockReturnValue(payload);
      mockIsTokenRevoked.mockResolvedValue(false);

      mockRequest.headers = {
        cookie: 'remitlend_jwt=url%40encoded%2Btoken',
      };

      await requireJwtAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockVerifyJwtToken).toHaveBeenCalledWith('url@encoded+token');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should return null for empty cookie value and throw 401', async () => {
      mockExtractBearerToken.mockReturnValue(null);
      mockRequest.headers = {
        cookie: 'remitlend_jwt=  ',
      };

      await expect(() =>
        requireJwtAuth(mockRequest as Request, mockResponse as Response, mockNext),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
        }),
      );
    });

    it('should ignore cookies with wrong name and throw 401', async () => {
      mockExtractBearerToken.mockReturnValue(null);
      mockRequest.headers = {
        cookie: 'other_cookie=some-value',
      };

      await expect(() =>
        requireJwtAuth(mockRequest as Request, mockResponse as Response, mockNext),
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
        }),
      );
    });
  });

  describe('requireScopes', () => {
    it('should grant access to admin:all regardless of required scopes', () => {
      mockRequest.user = {
        publicKey: 'GADMIN',
        role: 'admin',
        scopes: ['admin:all'],
        iat: 1000,
        exp: 2000,
      };

      const middleware = requireScopes('read:loans', 'write:repayment');
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should throw 403 when user is missing a required scope', () => {
      mockRequest.user = {
        publicKey: 'GBORROWER',
        role: 'borrower',
        scopes: ['read:loans'],
        iat: 1000,
        exp: 2000,
      };

      const middleware = requireScopes('write:repayment');

      expect(() => middleware(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 403,
        }),
      );
    });

    it('should grant access when user has all required scopes', () => {
      mockRequest.user = {
        publicKey: 'GBORROWER',
        role: 'borrower',
        scopes: ['read:loans', 'write:repayment'],
        iat: 1000,
        exp: 2000,
      };

      const middleware = requireScopes('read:loans', 'write:repayment');
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should throw 401 when user is not authenticated', () => {
      mockRequest.user = undefined;

      const middleware = requireScopes('read:loans');

      expect(() => middleware(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 401,
        }),
      );
    });
  });

  describe('requireWalletParamMatchesJwt', () => {
    it('should pass when param matches JWT publicKey', () => {
      mockRequest.user = {
        publicKey: 'GMATCH',
        role: 'borrower',
        scopes: [],
        iat: 1000,
        exp: 2000,
      };
      mockRequest.params = { walletId: 'GMATCH' };

      const middleware = requireWalletParamMatchesJwt('walletId');
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should throw 403 when param does not match JWT publicKey', () => {
      mockRequest.user = {
        publicKey: 'GREAL_USER',
        role: 'borrower',
        scopes: [],
        iat: 1000,
        exp: 2000,
      };
      mockRequest.params = { walletId: 'GDIFFERENT_USER' };

      const middleware = requireWalletParamMatchesJwt('walletId');

      expect(() => middleware(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 403,
        }),
      );
    });

    it('should throw 401 when user is not authenticated', () => {
      mockRequest.user = undefined;
      mockRequest.params = { walletId: 'GSOME_USER' };

      const middleware = requireWalletParamMatchesJwt('walletId');

      expect(() => middleware(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 401,
        }),
      );
    });

    it('should throw 400 when param is missing', () => {
      mockRequest.user = {
        publicKey: 'GMATCH',
        role: 'borrower',
        scopes: [],
        iat: 1000,
        exp: 2000,
      };
      mockRequest.params = {};

      const middleware = requireWalletParamMatchesJwt('walletId');

      expect(() => middleware(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 400,
        }),
      );
    });
  });
});
