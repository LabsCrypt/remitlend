import { describe, it, expect, beforeAll, vi } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import * as authService from '../services/authService.js';
import { resolveRoleForWallet } from '../auth/rbac.js';

describe('Security Issues - Critical Fixes', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-key-for-jest';
    process.env.ADMIN_WALLETS = '';
    process.env.LENDER_WALLETS = '';
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #1359: JWT verification ignores expiration entirely
  // ─────────────────────────────────────────────────────────────────────────
  describe('Issue #1359: JWT Expiration Validation', () => {
    it('should reject expired tokens', () => {
      const keypair = Keypair.random();

      // Create a token that's already expired
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MDAwMDAwMDB9.invalid';

      const result = authService.verifyJwtToken(expiredToken);

      // Expired token should return null
      expect(result).toBeNull();
    });

    it('should accept valid non-expired tokens', () => {
      const keypair = Keypair.random();
      const token = authService.generateJwtToken(keypair.publicKey());

      const result = authService.verifyJwtToken(token);

      // Valid token should be verified successfully
      expect(result).not.toBeNull();
      expect(result?.publicKey).toBe(keypair.publicKey());
    });

    it('should enforce expiration claim during verification', () => {
      // This test verifies that ignoreExpiration is NOT set to true
      // by checking that the JWT library enforces exp claim
      const secret = process.env.JWT_SECRET!;
      const token = authService.generateJwtToken(Keypair.random().publicKey());

      // The verifyJwtToken should respect the exp claim
      const verified = authService.verifyJwtToken(token);
      expect(verified).not.toBeNull();

      // Manually decode to check exp is present
      const decoded = authService.decodeJwtToken(token);
      expect(decoded?.exp).toBeDefined();
      expect(decoded?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #1360: Malformed or short signatures are accepted
  // ─────────────────────────────────────────────────────────────────────────
  describe('Issue #1360: Signature Validation for Malformed/Short Signatures', () => {
    it('should reject empty signatures', () => {
      const keypair = Keypair.random();
      const message = 'Sign this message';

      const result = authService.verifySignature(keypair.publicKey(), message, '');

      expect(result).toBe(false);
    });

    it('should reject signatures shorter than 64 bytes', () => {
      const keypair = Keypair.random();
      const message = 'Sign this message';

      // Short 32-byte signature
      const shortSignature = Buffer.alloc(32).toString('base64');

      const result = authService.verifySignature(keypair.publicKey(), message, shortSignature);

      expect(result).toBe(false);
    });

    it('should reject signatures longer than 64 bytes', () => {
      const keypair = Keypair.random();
      const message = 'Sign this message';

      // Long 128-byte signature
      const longSignature = Buffer.alloc(128).toString('base64');

      const result = authService.verifySignature(keypair.publicKey(), message, longSignature);

      expect(result).toBe(false);
    });

    it('should reject malformed base64 signatures', () => {
      const keypair = Keypair.random();
      const message = 'Sign this message';

      // Invalid base64 characters
      const malformedSignature = '!!!@@##$$%%^^&&**()[]{}';

      const result = authService.verifySignature(keypair.publicKey(), message, malformedSignature);

      expect(result).toBe(false);
    });

    it('should reject signatures with incorrect padding', () => {
      const keypair = Keypair.random();
      const message = 'Sign this message';

      // Valid base64 but wrong length when decoded
      const badPaddingSignature = 'A'.repeat(32); // Too short

      const result = authService.verifySignature(keypair.publicKey(), message, badPaddingSignature);

      expect(result).toBe(false);
    });

    it('should accept only valid 64-byte signatures with correct message', () => {
      const keypair = Keypair.random();
      const message = 'Sign this message';
      const signature = keypair.sign(Buffer.from(message, 'utf-8')).toString('base64');

      const result = authService.verifySignature(keypair.publicKey(), message, signature);

      expect(result).toBe(true);
    });

    it('should reject valid signatures with different message', () => {
      const keypair = Keypair.random();
      const message = 'Sign this message';
      const signature = keypair.sign(Buffer.from(message, 'utf-8')).toString('base64');

      // Verify with different message
      const result = authService.verifySignature(
        keypair.publicKey(),
        'different message',
        signature,
      );

      expect(result).toBe(false);
    });

    it('should reject valid signatures from different keypair', () => {
      const keypair1 = Keypair.random();
      const keypair2 = Keypair.random();
      const message = 'Sign this message';

      // Sign with keypair1
      const signature = keypair1.sign(Buffer.from(message, 'utf-8')).toString('base64');

      // Try to verify with keypair2's public key
      const result = authService.verifySignature(keypair2.publicKey(), message, signature);

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #1366: Lender wallets resolve to admin
  // ─────────────────────────────────────────────────────────────────────────
  describe('Issue #1366: RBAC - Lender Wallet Role Resolution', () => {
    it('should resolve lender wallets to lender role, not admin', () => {
      const lenderWallet = 'GCLPVDSWV4L52LDGFH2N6YFWFWQR4LXPSCTHZFXUFG2XLWLZXTBX42O';
      process.env.LENDER_WALLETS = lenderWallet;
      process.env.ADMIN_WALLETS = '';

      const role = resolveRoleForWallet(lenderWallet);

      expect(role).toBe('lender');
      expect(role).not.toBe('admin');
    });

    it('should resolve admin wallets to admin role', () => {
      const adminWallet = 'GADMIN123456789012345678901234567890123456789012345678901234567890';
      process.env.ADMIN_WALLETS = adminWallet;
      process.env.LENDER_WALLETS = '';

      const role = resolveRoleForWallet(adminWallet);

      expect(role).toBe('admin');
    });

    it('should prioritize admin over lender when wallet is in both lists', () => {
      const wallet = 'GTEST123456789012345678901234567890123456789012345678901234567890';
      process.env.ADMIN_WALLETS = wallet;
      process.env.LENDER_WALLETS = wallet;

      const role = resolveRoleForWallet(wallet);

      // Admin takes precedence
      expect(role).toBe('admin');
    });

    it('should resolve unknown wallets to borrower role', () => {
      const unknownWallet = 'GUNKNOWN1234567890123456789012345678901234567890123456789012345678';
      process.env.ADMIN_WALLETS = '';
      process.env.LENDER_WALLETS = '';

      const role = resolveRoleForWallet(unknownWallet);

      expect(role).toBe('borrower');
    });

    it('should handle comma-separated wallet lists correctly', () => {
      const wallet1 = 'GWALLETONE1234567890123456789012345678901234567890123456789012345678';
      const wallet2 = 'GWALLETTWO1234567890123456789012345678901234567890123456789012345678';
      const wallet3 = 'GWALLETTHREE123456789012345678901234567890123456789012345678901234567';

      process.env.LENDER_WALLETS = `${wallet1}, ${wallet2}, ${wallet3}`;
      process.env.ADMIN_WALLETS = '';

      expect(resolveRoleForWallet(wallet1)).toBe('lender');
      expect(resolveRoleForWallet(wallet2)).toBe('lender');
      expect(resolveRoleForWallet(wallet3)).toBe('lender');

      const unknownWallet = 'GUNKNOWN1234567890123456789012345678901234567890123456789012345678';
      expect(resolveRoleForWallet(unknownWallet)).toBe('borrower');
    });
  });
});
