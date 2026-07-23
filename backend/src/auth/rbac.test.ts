import { afterEach, describe, expect, it } from '@jest/globals';
import { resolveRoleForWallet, resolveScopesForRole } from '../rbac.js';

const ORIGINAL_ADMIN_WALLETS = process.env.ADMIN_WALLETS;
const ORIGINAL_LENDER_WALLETS = process.env.LENDER_WALLETS;

afterEach(() => {
  process.env.ADMIN_WALLETS = ORIGINAL_ADMIN_WALLETS;
  process.env.LENDER_WALLETS = ORIGINAL_LENDER_WALLETS;
});

describe('resolveRoleForWallet', () => {
  it('resolves configured admin wallets to admin', () => {
    process.env.ADMIN_WALLETS = 'GADMIN_ONE, GADMIN_TWO';
    process.env.LENDER_WALLETS = 'GLENDER_ONE';

    expect(resolveRoleForWallet('GADMIN_TWO')).toBe('admin');
  });

  it('resolves configured lender wallets to lender, not admin', () => {
    process.env.ADMIN_WALLETS = 'GADMIN_ONE';
    process.env.LENDER_WALLETS = 'GLENDER_ONE, GLENDER_TWO';

    expect(resolveRoleForWallet('GLENDER_TWO')).toBe('lender');
    expect(resolveScopesForRole(resolveRoleForWallet('GLENDER_TWO'))).not.toContain('admin:all');
  });

  it('defaults unknown wallets to borrower', () => {
    process.env.ADMIN_WALLETS = 'GADMIN_ONE';
    process.env.LENDER_WALLETS = 'GLENDER_ONE';

    expect(resolveRoleForWallet('GBORROWER')).toBe('borrower');
  });
});