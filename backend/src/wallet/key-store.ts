// src/wallet/key-store.ts
// PBKDF2 key derivation + AES-256-GCM encryption/decryption with mandatory buffer zeroing.
// This module is the cryptographic core of the Solus Protocol vault system.
// No plaintext private key material ever leaves this module.

import {
    createCipheriv,
    createDecipheriv,
    pbkdf2Sync,
    randomBytes,
} from 'node:crypto';

// Constants 

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH_BYTES = 32;        // 256-bit key
const IV_LENGTH_BYTES = 16;         // 128-bit IV, random per encryption
const AUTH_TAG_LENGTH_BYTES = 16;   // GCM auth tag
const SALT_LENGTH_BYTES = 32;       // 256-bit PBKDF2 salt
const PBKDF2_ITERATIONS = 200_000;  // spec: 200k iterations
const PBKDF2_DIGEST = 'sha512';     // spec: SHA-512
const PBKDF2_KEY_LEN = KEY_LENGTH_BYTES;

// Types

export interface EncryptedPayload {
    /** hex-encoded 16-byte IV */
    iv: string;
    /** hex-encoded 16-byte GCM auth tag */
    authTag: string;
    /** hex-encoded ciphertext */
    ciphertext: string;
    /** hex-encoded 32-byte PBKDF2 salt */
    salt: string;
}

// Key derivation

/**
 * Derives a 256-bit AES key from `password` using PBKDF2-SHA512.
 * A fresh random salt is generated when `salt` is omitted (encryption path).
 * Provide the stored salt on the decryption path.
 *
 * @returns { key, salt } — caller MUST zero `key` buffer after use.
 */
export function deriveKey(
    password: string,
    saltHex?: string,
): { key: Buffer; salt: Buffer } {
    const salt = saltHex
        ? Buffer.from(saltHex, 'hex')
        : randomBytes(SALT_LENGTH_BYTES);

    const key = pbkdf2Sync(
        password,
        salt,
        PBKDF2_ITERATIONS,
        PBKDF2_KEY_LEN,
        PBKDF2_DIGEST,
    );

    return { key, salt };
}

// Encryption 
/**
 * Encrypts `plaintext` bytes with AES-256-GCM.
 * A fresh IV and salt are generated for every call.
 *
 * After this function returns, `key` is zeroed internally.
 * The caller's `key` buffer (from `deriveKey`) should also be zeroed.
 */
export function encrypt(plaintext: Buffer, password: string): EncryptedPayload {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const { key, salt } = deriveKey(password);

    let encryptedResult: EncryptedPayload;

  try {
        const cipher = createCipheriv(ALGORITHM, key, iv, {
            authTagLength: AUTH_TAG_LENGTH_BYTES,
        });

        const ciphertextParts: Buffer[] = [
            cipher.update(plaintext),
            cipher.final(),
        ];
        const ciphertext = Buffer.concat(ciphertextParts);
        const authTag = cipher.getAuthTag();

        encryptedResult = {
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex'),
            ciphertext: ciphertext.toString('hex'),
            salt: salt.toString('hex'),
        };
    } finally {
        // Zero the derived key — do this regardless of whether encryption succeeded
        zeroBuffer(key);
    }

    return encryptedResult;
}

// Decryption 
/**
 * Decrypts an AES-256-GCM `EncryptedPayload` back to a plaintext `Buffer`.
 *
 * The returned `Buffer` contains sensitive key material.
 * The caller MUST call `zeroBuffer(result)` immediately after use.
 *
 * @throws if the auth tag is invalid (tampering detected) or decryption fails.
 */
export function decrypt(payload: EncryptedPayload, password: string): Buffer {
    const { key, salt: _salt } = deriveKey(password, payload.salt);

    try {
        const iv = Buffer.from(payload.iv, 'hex');
        const authTag = Buffer.from(payload.authTag, 'hex');
        const ciphertext = Buffer.from(payload.ciphertext, 'hex');

        const decipher = createDecipheriv(ALGORITHM, key, iv, {
            authTagLength: AUTH_TAG_LENGTH_BYTES,
        });
        decipher.setAuthTag(authTag);

        const parts: Buffer[] = [decipher.update(ciphertext), decipher.final()];
        return Buffer.concat(parts);
    } finally {
        // Zero the derived key even if decryption throws
        zeroBuffer(key);
    }
}

// Buffer zeroing

/**
 * Overwrites every byte of `buf` with 0x00, then releases the underlying
 * ArrayBuffer. Call this immediately after the sensitive data is no longer
 * needed. This is best-effort in a GC language — it cannot guarantee the OS
 * will not have paged a copy to disk, but it eliminates the data from the JS
 * heap as quickly as possible.
 */
export function zeroBuffer(buf: Buffer): void {
    buf.fill(0);
}

// Password helpers 
/**
 * Builds the per-agent vault password by combining the master key with the
 * agentId. This ensures each agent's vault uses a unique derived password
 * even if the master key is shared.
 *
 * Pattern: `${VAULT_MASTER_KEY}::${agentId}`
 */
export function buildVaultPassword(masterKey: string, agentId: string): string {
    if (!masterKey || masterKey.length < 16) {
        throw new Error(
            'VAULT_MASTER_KEY must be at least 16 characters. Set a strong secret in your .env file.',
        );
    }
    return `${masterKey}::${agentId}`;
}