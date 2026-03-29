export const USER_ROLES = ["admin", "borrower", "lender"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_SCOPES: Record<UserRole, string[]> = {
  admin: ["admin:all"],
  borrower: [
    "read:loans",
    "write:repayment",
    "read:score",
    "read:notifications",
    "write:notifications",
  ],
  lender: ["read:loans", "read:pool"],
};

const parseWalletSet = (wallets: string | undefined): Set<string> => {
  if (!wallets) return new Set();

  return new Set(
    wallets
      .split(",")
      .map((wallet) => wallet.trim())
      .filter((wallet) => wallet.length > 0),
  );
};

export const resolveRoleForWallet = (publicKey: string): UserRole => {
  const adminWallets = parseWalletSet(process.env.ADMIN_WALLETS);
  if (adminWallets.has(publicKey)) {
    return "admin";
  }

  const lenderWallets = parseWalletSet(process.env.LENDER_WALLETS);
  if (lenderWallets.has(publicKey)) {
    return "lender";
  }

  return "borrower";
};

export const resolveScopesForRole = (role: UserRole): string[] => {
  const ownScopes = ROLE_SCOPES[role] ?? [];
  if (role === "admin") {
    return [...ownScopes];
  }

  // Include admin scope only for admin; keep role scopes explicit for others.
  return [...ownScopes];
};
