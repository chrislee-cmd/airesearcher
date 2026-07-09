// AES-256-GCM at-rest encryption for stored OAuth refresh tokens.
//
// `user_google_oauth.refresh_token` is a long-lived Google credential. Even
// with the browser self-select policy dropped (deny-all RLS), a DB dump or
// backup leak would expose the plaintext token. We encrypt it at rest with a
// key that lives only in the server env (OAUTH_TOKEN_ENC_KEY), never in the DB.
//
// Stored format: `enc:v1:<base64(iv || tag || ciphertext)>`
//   - iv  : 12-byte GCM nonce (fresh random per encryption)
//   - tag : 16-byte GCM auth tag
//   - the `enc:v1:` prefix lets us distinguish ciphertext from legacy plaintext
//     rows so decryption is a no-op passthrough during the lazy backfill window
//     (see oauth-token-store.ts).
//
// Server-only: imports `@/env`, which reads the private key. Never import from
// a client component.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '@/env';

const ENC_PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16; // GCM auth tag length

// Decodes the base64 env key and asserts it's exactly 32 bytes (AES-256).
// Throws (fail-closed) if the key is missing or malformed — a misconfigured
// key must never silently fall back to weaker/plaintext storage.
function getKey(): Buffer {
  const raw = env.OAUTH_TOKEN_ENC_KEY;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'OAUTH_TOKEN_ENC_KEY must be 32 bytes base64-encoded (AES-256)',
    );
  }
  return key;
}

// True when a stored value is in our ciphertext envelope (vs legacy plaintext).
export function isEncryptedToken(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

// Encrypts a plaintext refresh_token into the `enc:v1:` envelope.
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

// Reverses encryptToken. Legacy plaintext (no `enc:v1:` prefix) is returned
// as-is so pre-encryption rows keep working until they're lazily re-encrypted.
export function decryptToken(stored: string): string {
  if (!isEncryptedToken(stored)) {
    return stored;
  }
  const payload = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
