# JWT Revocation & Role-Change Propagation

## Problem

`generateJwtToken` (`backend/src/services/authService.ts`) embeds `role` and
`scopes` in the JWT at login time, and tokens are valid for `JWT_EXPIRES_IN`
(24h). Roles are derived from `ADMIN_WALLETS` / `LENDER_WALLETS` env vars
(`backend/src/auth/rbac.ts`). Before this change, removing a wallet from
`ADMIN_WALLETS` had no effect on tokens already issued to that wallet — the
embedded `admin:all` scope kept working until the token's natural expiry, up
to 24h later.

## Strategy

Two complementary mechanisms close this gap, both enforced in
`requireJwtAuth` / `optionalJwtAuth` (`backend/src/middleware/jwtAuth.ts`):

### 1. Scope capping (role-change propagation)

On every request, after verifying the token's signature and expiry, the
middleware re-resolves the wallet's **current** role from env
(`resolveRoleForWallet`) and intersects the token's embedded `scopes` with
whatever that current role grants (`capPayloadToCurrentRole`):

```
effective_scopes = embedded_scopes ∩ scopes_for(current_role(wallet))
```

A token can never carry more privilege than its wallet's role currently
allows. If a wallet is removed from `ADMIN_WALLETS`, the next request with
its old token resolves to the `borrower` role's scope set, `admin:all` is
filtered out, and `requireScopes("admin:all")` fails — immediately, not
after 24h.

This is deliberately an intersection, not a wholesale overwrite: a token
minted with a narrower scope set than its role would normally get (e.g. a
purpose-limited session) is still respected, since intersection only ever
removes privileges, never adds them.

**Max privilege-retention window for a role downgrade: effectively 0** (next
request after the env change/role resolution takes effect).

### 2. Explicit revocation (logout)

Each token carries a `jti` (UUID, set in `generateJwtToken`). `POST
/api/auth/logout` calls `revokeToken(jti, exp)`, which blacklists the jti in
the cache (`cacheService`) until the token's natural expiry
(`backend/src/services/authService.ts`). `requireJwtAuth` checks
`isTokenRevoked(jti)` on every request and rejects revoked tokens with 401.

This covers the case scope-capping doesn't: a wallet's role hasn't changed,
but the *session itself* needs to be killed early (user-initiated logout,
suspected token leak, etc).

**Max privilege-retention window after logout: 0** (the very next request
with that token is rejected), modulo the fail-open behavior below.

### Fail-open on cache unavailability

The revocation check is wrapped in a 250ms timeout
(`REVOCATION_CHECK_TIMEOUT_MS` in `authService.ts`) and fails open (treats
the token as not revoked) if the cache backend doesn't respond in time. This
mirrors the existing fail-open posture of `idempotencyMiddleware` — an
unreachable Redis degrades to "logout doesn't take effect immediately"
rather than taking the entire API down. Scope capping (mechanism 1) has no
such dependency, since `resolveRoleForWallet` only reads env vars.

## What's NOT covered

- This is still a stateless-JWT design, not a session store. There's no
  global "log out all sessions for this wallet" — only per-token logout via
  its own `jti`, or implicitly via a role change.
- No OAuth/OIDC integration; revocation is a custom Redis-backed blacklist.
