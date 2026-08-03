import crypto from 'node:crypto';
import { pool } from '../db/connection.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const DEK_LENGTH = 32;
const KEK_ID = process.env.PII_KEK_ID ?? 'default-kek';
const KMS_ENDPOINT = process.env.PII_KMS_ENDPOINT ?? '';

interface EncryptedField {
  ciphertext: Buffer;
  gcm_nonce: Buffer;
  dek_wrapped: Buffer;
  dek_kek_id: string;
}

async function unwrapDek(dekWrapped: Buffer, kekId: string): Promise<Buffer> {
  if (KMS_ENDPOINT) {
    const resp = await fetch(`${KMS_ENDPOINT}/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kek_id: kekId, wrapped_key: dekWrapped.toString('base64') }),
    });
    if (!resp.ok) throw new Error(`KMS unwrap failed: ${resp.status}`);
    const { plaintext } = (await resp.json()) as { plaintext: string };
    return Buffer.from(plaintext, 'base64');
  }
  const kek = Buffer.from(process.env.PII_KEK_KEY ?? '0'.repeat(64), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, dekWrapped.subarray(0, 12));
  decipher.setAuthTag(dekWrapped.subarray(12, 28));
  const decrypted = Buffer.concat([decipher.update(dekWrapped.subarray(28)), decipher.final()]);
  return decrypted;
}

async function wrapDek(dek: Buffer): Promise<Buffer> {
  if (KMS_ENDPOINT) {
    const resp = await fetch(`${KMS_ENDPOINT}/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kek_id: KEK_ID, plaintext: dek.toString('base64') }),
    });
    if (!resp.ok) throw new Error(`KMS wrap failed: ${resp.status}`);
    const { wrapped_key } = (await resp.json()) as { wrapped_key: string };
    return Buffer.from(wrapped_key, 'base64');
  }
  const kek = Buffer.from(process.env.PII_KEK_KEY ?? '0'.repeat(64), 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export async function encryptField(plaintext: string): Promise<EncryptedField> {
  const dek = crypto.randomBytes(DEK_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, tag]);
  const dekWrapped = await wrapDek(dek);
  return { ciphertext, gcm_nonce: iv, dek_wrapped: dekWrapped, dek_kek_id: KEK_ID };
}

export async function decryptField(
  recordId: string,
  field: string,
  ciphertext: Buffer,
  gcmNonce: Buffer,
  dekWrapped: Buffer,
  dekKekId: string,
  actor: string,
  reason: string,
  requestId: string,
): Promise<string> {
  const dek = await unwrapDek(dekWrapped, dekKekId);
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encryptedData = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, dek, gcmNonce);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

  await logPiiAccess(recordId, field, actor, reason, requestId);

  return decrypted.toString('utf8');
}

async function logPiiAccess(
  recordId: string,
  field: string,
  actor: string,
  reason: string,
  requestId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO pii_access_log (id, actor, record_id, field, reason, request_id, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
    [actor, recordId, field, reason, requestId],
  );
}

export function maskValue(value: string, field: 'email' | 'phone' | 'name'): string {
  if (field === 'email') {
    const [local, domain] = value.split('@');
    if (!domain) return '***';
    const maskedLocal = local && local.length > 0 ? local[0] + '***' : '***';
    const domainParts = domain.split('.');
    const maskedDomain =
      domainParts.length > 1 ? domainParts[0]![0] + '***.' + domainParts.slice(1).join('.') : '***';
    return `${maskedLocal}@${maskedDomain}`;
  }
  if (field === 'phone') {
    if (value.length <= 4) return '****';
    return '+xx...****' + value.slice(-2);
  }
  if (field === 'name') {
    if (value.length <= 1) return '*';
    return value[0]! + '***' + (value.length > 1 ? value.slice(-1) : '');
  }
  return '***';
}
