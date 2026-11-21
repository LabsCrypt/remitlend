import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  const configured = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!configured) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY must be configured to store webhook secrets');
  }
  return crypto.createHash('sha256').update(configured).digest();
}

export function encryptWebhookSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptWebhookSecret(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  // Existing plaintext rows remain readable during migration; all newly written
  // values use the authenticated encrypted format above.
  if (!value.startsWith(PREFIX)) return value;
  const [iv, tag, ciphertext] = value.slice(PREFIX.length).split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Invalid encrypted webhook secret');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
