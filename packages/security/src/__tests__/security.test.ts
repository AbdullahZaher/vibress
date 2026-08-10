import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  dummyVerifyPassword,
  generateOpaqueToken,
  hashToken,
  hasPermission,
  isOwner,
} from '../index';

describe('Password Primitives', () => {
  it('validates password policy correctly', () => {
    expect(validatePasswordPolicy('short').valid).toBe(false);
    expect(validatePasswordPolicy('short').reason).toContain('at least 12 characters');
    expect(validatePasswordPolicy('validpassword123').valid).toBe(true);
    expect(validatePasswordPolicy('a'.repeat(129)).valid).toBe(false);
  });

  it('hashes and verifies passwords with Argon2id', async () => {
    const password = 'SecurePassword123!';
    const hash = await hashPassword(password);

    expect(hash).toContain('$argon2id$');
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, 'WrongPassword123!')).toBe(false);
  });

  it('handles dummy verify password safely', async () => {
    const result = await dummyVerifyPassword();
    expect(result).toBe(false);
  });
});

describe('Token Primitives', () => {
  it('generates high entropy opaque tokens', () => {
    const token1 = generateOpaqueToken();
    const token2 = generateOpaqueToken();
    expect(token1).toHaveLength(64); // 32 bytes in hex
    expect(token2).toHaveLength(64);
    expect(token1).not.toBe(token2);
  });

  it('hashes tokens deterministically with SHA-256', () => {
    const token = generateOpaqueToken();
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    expect(hash1).toHaveLength(64); // 256 bits in hex
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(token);
  });
});

describe('Authorization Primitives', () => {
  it('resolves owner role as having all permissions', () => {
    expect(hasPermission([], 'users.read', ['owner'])).toBe(true);
    expect(hasPermission([], 'random.permission', ['owner'])).toBe(true);
  });

  it('resolves explicit permissions when user is not owner', () => {
    expect(hasPermission(['users.read'], 'users.read', ['editor'])).toBe(true);
    expect(hasPermission(['users.read'], 'users.delete', ['editor'])).toBe(false);
  });

  it('checks owner status', () => {
    expect(isOwner(['owner'])).toBe(true);
    expect(isOwner(['editor', 'author'])).toBe(false);
  });
});
