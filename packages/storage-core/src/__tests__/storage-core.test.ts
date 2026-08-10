import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  LocalStorageProvider,
  StorageRegistry,
  StoragePathTraversalError,
  StorageKeyInvalidError,
} from '../index';

describe('Storage Core & LocalStorageProvider', () => {
  let tempDir: string;
  let storageRoot: string;
  let provider: LocalStorageProvider;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibress-storage-test-'));
    storageRoot = path.join(tempDir, 'media');
    const tempUploadDir = path.join(tempDir, 'temp');

    provider = new LocalStorageProvider({
      storageRoot,
      tempDir: tempUploadDir,
      baseUrl: '/content/media',
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should put and get local storage object', async () => {
    const key = 'images/2026/08/test.txt';
    const body = Buffer.from('hello vibress media');

    const result = await provider.put({
      key,
      body,
      contentType: 'text/plain',
    });

    expect(result.key).toBe(key);
    expect(result.url).toBe('/content/media/images/2026/08/test.txt');
    expect(result.size).toBe(body.length);

    const exists = await provider.exists(key);
    expect(exists).toBe(true);
  });

  it('should delete existing local storage object', async () => {
    const key = 'images/delete-me.txt';
    await provider.put({ key, body: Buffer.from('delete me') });

    expect(await provider.exists(key)).toBe(true);
    await provider.delete(key);
    expect(await provider.exists(key)).toBe(false);
  });

  it('should reject path traversal attempts in put', async () => {
    const dangerousKeys = [
      '../etc/passwd',
      '../../secret.txt',
      'images/../../secret.txt',
      '..\\windows\\system32',
      '/absolute/path.txt',
      'images/\0nullbyte.png',
    ];

    for (const key of dangerousKeys) {
      await expect(
        provider.put({ key, body: Buffer.from('data') })
      ).rejects.toThrow(StoragePathTraversalError);
    }
  });

  it('should reject empty or invalid storage keys', async () => {
    await expect(
      provider.put({ key: '', body: Buffer.from('data') })
    ).rejects.toThrow(StorageKeyInvalidError);
  });

  it('should register and resolve providers in StorageRegistry', () => {
    const registry = new StorageRegistry();
    registry.register(provider);
    registry.setActiveProvider('local');

    expect(registry.getActiveProvider()).toBe(provider);
    expect(registry.getProvider('local')).toBe(provider);
    expect(registry.hasProvider('local')).toBe(true);
  });
});
