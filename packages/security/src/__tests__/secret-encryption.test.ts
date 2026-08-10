import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, SecretEncryptionError } from '../encryption/secret-encryption';

describe('Secret Encryption (AES-256-GCM)', () => {
  const TEST_KEY = 'a'.repeat(64);

  it('should encrypt and decrypt a secret correctly', () => {
    const secret = 'my-super-secret-aws-key-12345';
    const encrypted = encryptSecret(secret, TEST_KEY);

    expect(encrypted).not.toContain(secret);
    expect(JSON.parse(encrypted)).toHaveProperty('v', 1);

    const decrypted = decryptSecret(encrypted, TEST_KEY);
    expect(decrypted).toBe(secret);
  });

  it('should fail if master key is missing', () => {
    const originalEnv = process.env.VIBRESS_ENCRYPTION_KEY;
    delete process.env.VIBRESS_ENCRYPTION_KEY;

    expect(() => encryptSecret('test')).toThrow(SecretEncryptionError);

    if (originalEnv) process.env.VIBRESS_ENCRYPTION_KEY = originalEnv;
  });

  it('should fail decryption if wrong key is provided', () => {
    const secret = 'my-secret';
    const encrypted = encryptSecret(secret, TEST_KEY);
    const WRONG_KEY = 'b'.repeat(64);

    expect(() => decryptSecret(encrypted, WRONG_KEY)).toThrow('Failed to decrypt secret');
  });

  it('should fail decryption if ciphertext is tampered', () => {
    const secret = 'my-secret';
    const encrypted = encryptSecret(secret, TEST_KEY);
    const parsed = JSON.parse(encrypted);
    parsed.data = 'ff' + parsed.data.substring(2);

    expect(() => decryptSecret(JSON.stringify(parsed), TEST_KEY)).toThrow();
  });
});
