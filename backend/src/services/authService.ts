import jwt from 'jsonwebtoken';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import crypto from 'crypto';
import { resolveRoleForWallet, resolveScopesForRole, type UserRole } from '../auth/rbac.js';
import { cacheService } from './cacheService.js';

export interface JwtPayload {
  publicKey: string;
  role: UserRole;
  scopes: string[];
  jti: string;
  iat: number;
  exp: number;
}

export interface ChallengeMessage {
  message: string;
  nonce: string;
  timestamp: number;
  expiresIn: number;
}

const JWT_EXPIRES_IN = '24h';
const CHALLENGE_EXPIRES_IN_MS = 5 * 60 * 1000;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

export function generateChallenge(publicKey: string): ChallengeMessage {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('Invalid Stellar public key');
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  const timestamp = Date.now();

  const message = `Sign this message to authenticate with RemitLend.\n\nNonce: ${nonce}\nTimestamp: ${timestamp}\n\nThis request will expire in 5 minutes.`;

  return {
    message,
    nonce,
    timestamp,
    expiresIn: CHALLENGE_EXPIRES_IN_MS,
  };
}

export function verifySignature(publicKey: string, message: string, signature: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    return false;
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(signature)) {
    return false;
  }

  try {
    const signatureBytes = Buffer.from(signature, 'base64');
    if (signatureBytes.length !== 64) {
      return false;
    }

    const messageBytes = Buffer.from(message, 'utf-8');

    return Keypair.fromPublicKey(publicKey).verify(messageBytes, signatureBytes);
  } catch {
    return false;
  }
}

/**
 * Verifies that a challenge timestamp is still within the allowed age.
 *
 * A challenge is considered valid only when:
 * - the timestamp is a valid finite number;
 * - it is not in the future; and
 * - its age does not exceed the configured maximum.
 */
export function verifyChallengeTimestamp(
  timestamp: number,
  maxAgeMs: number = CHALLENGE_EXPIRES_IN_MS,
): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return false;
  }

  const now = Date.now();
  const age = now - timestamp;

  // Reject timestamps from the future.
  if (age < 0) {
    return false;
  }

  // Reject expired challenges.
  return age <= maxAgeMs;
}

export function generateJwtToken(publicKey: string): string {
  const secret = getJwtSecret();
  const role = resolveRoleForWallet(publicKey);
  const scopes = resolveScopesForRole(role);

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    publicKey,
    role,
    scopes,
    jti: crypto.randomUUID(),
  };

  return jwt.sign(payload, secret, {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

export function verifyJwtToken(token: string): JwtPayload | null {
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as JwtPayload;

    return decoded;
  } catch {
    return null;
  }
}

const REVOKED_JTI_PREFIX = 'revoked-jti:';

/**
 * Explicitly revokes a single token (e.g. on logout) by blacklisting its
 * jti until the token's natural expiry.
 */
export async function revokeToken(jti: string, exp: number): Promise<void> {
  const ttlSeconds = exp - Math.floor(Date.now() / 1000);
  if (ttlSeconds <= 0) return;

  await cacheService.set(`${REVOKED_JTI_PREFIX}${jti}`, true, ttlSeconds);
}

const REVOCATION_CHECK_TIMEOUT_MS = 250;

export async function isTokenRevoked(jti: string): Promise<boolean> {
  try {
    const revoked = await Promise.race([
      cacheService.get<boolean>(`${REVOKED_JTI_PREFIX}${jti}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REVOCATION_CHECK_TIMEOUT_MS)),
    ]);

    return revoked === true;
  } catch {
    return false;
  }
}

export function decodeJwtToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload | null;
  } catch {
    return null;
  }
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1] ?? null;
}
